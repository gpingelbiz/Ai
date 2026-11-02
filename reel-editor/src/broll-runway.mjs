import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { claudeText, claudeLook, firstJSON, hasClaude } from "./claude.mjs";
import { brollCount, brollCandidates, checkPick, subjectWords, spokenInShot, readRecent, rememberScenes, uniqueScenes } from "./broll.mjs";
import { norm } from "./text.mjs";
import { hasRunway, makeClip, animateStill, estimateClip, organization, fitPrompt, modelInfo, makeSound } from "./runway.mjs";
import { recordUsage, reelUsageNote } from "./usage.mjs";
import { log, warn, readJSON, writeJSON, ensureDir, run, r3 } from "./util.mjs";

export const PROMPT_VERSION = "literal-video-v4";

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

export function runwayPicksPrompt({ candidates, transcript, hook, count, spacing = 8, style = "", recent = [], duration = 2.4 }) {
  return `You are choosing short moving cutaways for Greg's talking-head reel.
Reply with JSON only. Use no tools.

Read the whole passage first. Understand its story, setting, analogy,
joke and lesson before choosing pictures.

Return up to ${count + 2} useful candidates, ranked strongest first.
The editor may use at most ${count}. Fewer candidates, including zero,
are correct. Nearby alternatives may compete for one slot.
Accepted shots require ${spacing} seconds from one shot's END to the next START.

Choose only moments where a picture makes these exact words clearer,
demonstrates something useful or completes the joke.
Preserve Greg's reactions, conviction, personal admissions and final
instruction. Respect the supplied hook boundaries.

Every scene comes from this reel's words or its own established setting.
Show named objects, animals and places literally, including analogies.
A jungle stays a jungle; a snake stays a snake; a coconut stays a coconut.
Never replace the subject with another metaphor or a brand-world prop.
Skip abstract lines unless a specific picture makes them clearer.

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
1.2 and ${Math.min(2.5, duration)} seconds. Fit one readable event inside the relevant words.
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
Exclude attacks, threats, distress, injury and weapon use against anyone.
Exclude hanging ropes or loops, neck contact, noose-like compositions,
self-harm and death associations.
Judge the picture together with overlapping and neighbouring words.
For dangerous spoken actions, choose harmless behaviour by the SAME
named subject only when the combined reading stays safe.
Otherwise leave Greg visible. Never substitute an unrelated object.

Use one physical event, one location and one camera instruction.
Keep the assembled Runway prompts under 1,000 JavaScript string units.
${style ? `Optional visual style: ${style}` : ""}
${recent.length ? `Recent scenes; choose a different relevant event or leave Greg visible:\n${uniqueScenes(recent).slice(-12).map((s) => `- ${s}`).join("\n")}` : ""}

Hook:
${hook || "(none)"}

Whole passage:
${transcript || ""}

Available caption lines and times:
${candidates.map((c) => `${c.i}: ${c.start.toFixed(1)}s ${c.text}`).join("\n")}

Reply exactly in this shape, ranked strongest first:
{"picks":[{"line":N,"shows":"...","duration":S,"kind":"action","scene":"...","endScene":"...","action":"...","motion":"...","sound":"..."}]}`;
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
  const end = Math.min(start + Math.max(1.2, Math.min(len, requested)), until, card);
  const duration = end - start;
  if (duration < 1.2 - 0.000001) return null;
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
    const duration = Math.min(t.duration, next ? next.start - gap - t.start : Infinity);
    const prev = shots.filter((s) => s.start < t.start).sort((a, b) => b.start - a.start)[0];
    const prevDuration = prev ? Math.min(prev.duration, t.start - gap - prev.start) : Infinity;
    if (duration < 1.2 - 0.000001 || prevDuration < 1.2 - 0.000001) continue;
    if (prev) prev.duration = r3(prevDuration);
    shots.push({ line: p.line, start: r3(t.start), duration: r3(duration), text: c.text, scene: String(p.scene).trim(), shows: p.shows, rank: p.rank });
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
export function videoMotion(pick, { retry = false } = {}) {
  const action = positiveDescription(pick.action, `${positiveDescription(pick.shows, "The subject.").replace(/\.$/, "")} moves.`);
  const brief = `${pick.scene || ""} ${action} ${positiveDescription(pick.motion)}`;
  const placeReveal = /\breveal(?:s|ing)?\b/i.test(positiveDescription(pick.motion)) && /\b(place|jungle|clearing|forest|path|road|street|destination|city|valley|room|beach|landscape)\b/i.test(brief);
  const moving = placeReveal || /\btravel(?:s|ling|ing)?\b/i.test(brief);
  const camera = !retry && moving ? positiveDescription(pick.motion, "Locked camera.") : "Locked camera.";
  return fitPrompt(`${action} Real-time movement beginning immediately. ${camera}`);
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
    await runFn("ffmpeg", ["-y", "-loglevel", "error", "-t", String(duration), "-i", file, "-vf", "fps=4,scale=64:64,format=gray", "-f", "rawvideo", raw], { quiet: true });
    return frameChange(fs.readFileSync(raw));
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
export async function trimRunwayClip(file, duration, { runFn = run, dir = path.dirname(file) } = {}) {
  const full = file.replace(/\.mp4$/i, ".full.mp4");
  fs.renameSync(file, full);
  const tmp = fs.mkdtempSync(path.join(dir, "action-"));
  try {
    const probe = await runFn("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "default=noprint_wrappers=1:nokey=1", full], { capture: true });
    const clipDuration = Number(probe.out?.trim());
    if (!(clipDuration > 0)) throw new Error("clip duration unavailable");
    const raw = path.join(tmp, "frames.gray");
    await runFn("ffmpeg", ["-y", "-loglevel", "error", "-i", full, "-vf", "fps=8,scale=64:64,format=gray", "-f", "rawvideo", raw], { quiet: true });
    const inPoint = actionInPoint(fs.readFileSync(raw), duration, clipDuration);
    await runFn("ffmpeg", ["-y", "-loglevel", "error", "-ss", String(inPoint), "-i", full, "-t", String(duration + 0.3), "-an", "-c:v", "libx264", "-preset", "fast", "-crf", "17", "-r", "30", "-g", "30", "-pix_fmt", "yuv420p", "-movflags", "+faststart", file], { quiet: true });
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
Is the complete action area visible above the actual captions?
Check faces, readable lettering, labels and invented evidence.

Could this picture together with those words suggest a noose,
self-harm, death, an attack, weapon use against someone,
or anyone threatened or hurt?

Set shows=false for ambiguity, unsuitable framing, unwanted faces
or lettering, damaged anatomy, or uncertainty.
Set dark=true for a dangerous association.
Reply JSON only:
{"shows":true|false,"dark":true|false,"why":"..."}`;
}

export const clipOpenPrompt = (frames) => `Inspect these three frames in time order from the exact section
proposed for the reel: ${frames.map((f) => `${JSON.stringify(f.file)} at ${f.time}s`).join(", ")}.
Describe the subject in each frame and the physical changes.
Distinguish subject movement from camera movement.
State uncertainty where the frames do not establish what happened.
Reply JSON only: {"seen":"..."}`;

export function clipCheckPrompt({ seen, frames, pick, shot, groups, inPoint = 0 }) {
  return `Used source interval: ${inPoint} to ${inPoint + shot.duration}.
Inspect these frames: ${frames.map((f) => JSON.stringify(f.file)).join(", ")}.
Independent description: ${JSON.stringify(seen)}.
Required subject: ${JSON.stringify(pick.shows)}.
Required physical event: ${JSON.stringify(pick.action)}.
Shot kind: ${pick.kind || "action"}. For ambient shots, gentle continuous movement establishes the event.
Overlapping words and captions: ${JSON.stringify(spokenInShot(shot, groups, { len: shot.duration }))}.
Neighbouring words: ${JSON.stringify(neighbouringWords(shot, groups))}.

Is the same subject intact and recognizable throughout these frames?
Does its position or state change relative to its surroundings,
establishing the required event inside this interval?
Camera movement, lighting changes and a pushed still do not count.
Check disappearing parts, transformations and believable contact.

Could any frame together with these words suggest a noose,
self-harm, death, an attack, weapon use against someone,
or anyone threatened or hurt?
Check faces and readable lettering.

Use false when subject identity or action is uncertain.
Reply JSON only:
{"shows":true|false,"action":true|false,"dark":true|false,"why":"..."}`;
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
  const tmp = fs.mkdtempSync(path.join(dir, "clip-check-"));
  try {
    // A floor of one grey level rejects near-frozen output; vision checks subject identity and action.
    const motion = await measureMotion(file, shot.duration, { runFn: runner, dir: tmp });
    const frozen = motion.mean < threshold;
    const times = [0, shot.duration / 2, Math.max(0, shot.duration - 1 / 30)];
    const frames = [];
    for (let i = 0; i < times.length; i++) {
      const png = path.join(tmp, `${i + 1}.png`);
      await runner("ffmpeg", ["-y", "-loglevel", "error", "-ss", String(times[i]), "-i", file, "-frames:v", "1", "-vf", "scale=360:-2", png], { quiet: true });
      if (!fs.existsSync(png)) throw new Error("video check frame missing");
      frames.push({ file: path.relative(dir, png), time: inPoint + times[i] });
    }
    try {
      const open = await lookJSON(clipOpenPrompt(frames), hasSeen, look, dir);
      const result = await lookJSON(clipCheckPrompt({ seen: open.seen, frames, pick, shot, groups, inPoint }), hasBools(["shows", "action", "dark"]), look, dir);
      return { ...result, look: "pass", motion, ok: !frozen && result.shows && result.action && !result.dark, why: frozen ? `frozen clip (mean change ${r3(motion.mean)} < ${threshold})` : `shows ${result.shows ? "yes" : "no"}, action ${result.action ? "yes" : "no"}, dark ${result.dark ? "yes" : "no"}: ${String(result.why || "subject or action failed the video check").slice(0, 600)}` };
    } catch (e) {
      warn(`b-roll: video look unavailable after retry (${String(e.message).split("\n")[0]}); ${frozen ? "frozen clip rejected" : "accepting measured motion"}`);
      return { ok: !frozen, look: "unavailable", motion, why: frozen ? "frozen clip; video look unavailable" : "video look unavailable after retry; motion passed" };
    }
  } catch (e) {
    return { ok: false, why: `video check unavailable: ${String(e.message).split("\n")[0]}` };
  } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
}

export async function makeRunwayBroll({ workDir, groups, duration, hook, cta, settings = {}, force = false, busy = [], tail = 1, deps = {} }) {
  const dir = ensureDir(path.join(workDir, "broll"));
  const planPath = path.join(dir, "broll.json");
  const seconds = Math.max(2, Math.min(10, Math.round(settings.videoSeconds ?? 5)));
  const len = Math.max(1.2, Math.min(2.5, seconds, settings.duration ?? 2.4));
  const gap = settings.gap ?? 6;
  const max = brollCount(duration, { max: busy.length ? settings.maxWithGraphics ?? 2 : settings.max ?? 3, every: settings.every ?? 12 });
  if (!max) { log("b-roll: reel too short, skipped"); return []; }
  const candidates = brollCandidates(groups, duration, { hook, cta, len: 1.2, busy, tail, clearStart: settings.clearStart ?? 0 });
  const timing = (p, c) => runwayTiming(p, c, groups, { len, until: Math.min(duration - tail, cta?.start ?? Infinity), busy });
  if (!candidates.length) { log("b-roll: no room after the hook, skipped"); return []; }
  const key = `${PROMPT_VERSION}|${JSON.stringify({ candidates, groups, settings, hook, cta, duration, busy, tail })}`;
  if (!force && fs.existsSync(planPath)) {
    const saved = readJSON(planPath);
    if (saved.promptVersion === PROMPT_VERSION && saved.key === key && saved.shots?.length && saved.shots.every((s) => /\.mp4$/i.test(s.file || "") && s.move === "none" && s.moves?.ok && fs.existsSync(s.file) && (!s.sfx || fs.existsSync(s.sfx)))) {
      log(`b-roll: reusing ${saved.shots.length} Runway clip${saved.shots.length === 1 ? "" : "s"} from ${dir} (nothing bought)`);
      return saved.shots;
    }
  }
  const has = deps.hasRunway || hasRunway, claude = deps.claudeText || claudeText, look = deps.claudeLook || claudeLook, make = deps.makeClip || makeClip, animate = deps.animateStill || animateStill, org = deps.organization || organization, record = deps.recordUsage || recordUsage, sound = deps.makeSound || makeSound;
  if (!has()) { warn("Runway b-roll needs RUNWAY_API_KEY; rendering without it"); return []; }
  if (!(deps.hasClaude || hasClaude)()) { warn("Runway b-roll needs the Claude Code CLI to pick the scenes; skipped"); return []; }

  // Budget before anything is bought: the per-reel cap and the account balance.
  const baseModels = shotModels({ kind: "ambient" }, settings);
  if (settings.actionVideoModel) modelInfo(settings.actionVideoModel, "video");
  if (settings.retryVideoModel) modelInfo(settings.retryVideoModel, "video");
  const est = estimateClip({ ...baseModels, imageRatio: settings.imageRatio });
  const cap = settings.maxCreditsPerReel ?? 150;
  const count = Math.max(0, Math.min(max, Math.floor(cap / est.credits)));
  if (!count) { warn(`b-roll: one Runway clip costs ${est.credits} credits, over the per-reel cap of ${cap}; rendering without it`); return []; }
  let balance = null;
  try { balance = (await org()).creditBalance; } catch (e) { warn(`runway: could not read the balance (${String(e.message).split("\n")[0]})`); }
  if (balance != null && balance < est.credits) { warn(`b-roll: Runway balance is ${balance} credits, under the ${est.credits} one clip needs; rendering without it`); return []; }
  const affordable = balance != null ? Math.max(0, Math.min(count, Math.floor((balance - (settings.keepCredits ?? 0)) / est.credits))) : count;
  if (!affordable) { warn(`b-roll: Runway balance ${balance} credits leaves no room above keepCredits; rendering without it`); return []; }

  const t0 = Date.now();
  let picks;
  try {
    log(`b-roll: Claude is picking ${affordable} moment${affordable === 1 ? "" : "s"} for Runway (about ${est.credits} credits ≈ $${est.dollars.toFixed(2)} each)…`);
    const transcript = groups.map((g) => g.text).join(" ");
    const reply = await claude(runwayPicksPrompt({ candidates, transcript, hook: hook?.text, count: affordable, spacing: gap, style: settings.style || "", recent: readRecent(), duration: len }), { timeoutMs: 240000 });
    picks = (firstJSON(reply).picks || []).map((p, i) => ({ ...p, rank: i + 1 })).filter((p) => {
      const candidate = candidates.find((c) => c.i === p.line);
      const t = candidate && timing(p, candidate);
      const why = !t ? "no room for this subject" : checkPick(p, { ...candidate, start: t.start }, groups, { len: t.duration });
      if (why) warn(`b-roll: rejected line ${p.line}: ${why}`);
      return !why;
    });
  } catch (e) {
    warn(`b-roll: ${String(e.message).split("\n")[0]}; rendering without it`);
    return [];
  }
  const placed = placeRunwayBroll(picks, candidates, { gap, max: affordable, timing });
  const byLine = new Map();
  for (const p of picks) if (!byLine.has(p.line)) byLine.set(p.line, p);
  for (const f of fs.readdirSync(dir)) if (/^broll-\d+(?:\.[\w.]+)?\.(png|jpg|mp4|wav)$/i.test(f)) fs.rmSync(path.join(dir, f), { force: true });
  const shots = [];
  const items = [];
  const budget = Math.min(cap, balance == null ? Infinity : Math.max(0, balance - (settings.keepCredits ?? 0)));
  const spent = (pending = []) => [...items, ...pending].reduce((sum, i) => sum + (i.credits || 0), 0);
  const canSpend = (credits, pending = []) => spent(pending) + credits <= budget;
  for (let k = 0; k < placed.length; k++) {
    const s = placed[k];
    const p = byLine.get(s.line);
    const models = shotModels(p, settings), seed = shotSeed(workDir, s.line);
    const est = estimateClip({ ...models, imageRatio: settings.imageRatio, sfxSeconds: settings.sfx && p.sound ? s.duration : 0 });
    const retryVideoModel = settings.retryVideoModel || models.videoModel;
    const retryInfo = modelInfo(retryVideoModel, "video");
    const retrySeconds = Math.max(retryInfo.duration[0], Math.min(retryInfo.duration[1], models.seconds));
    const retryCredits = estimateClip({ seconds: retrySeconds, videoModel: retryVideoModel }).video;
    let checkResult = "skipped", seen = "", retryWhy = "";
    let clip = null, stillApproved = settings.check === false;
    let sentMotion;
    try { sentMotion = videoMotion(p); }
    catch (e) { warn(`b-roll: clip ${k + 1} skipped (${e.message})`); continue; }
    const check = settings.check === false ? undefined : async (png, context = {}) => {
      try {
        // Ask open first in a separate call: the subject must not cue the picture's description.
        if (!context.end) seen = "";
        const open = await lookJSON(stillOpenPrompt(path.basename(png)), hasSeen, look, dir);
        const description = open.seen.trim().slice(0, 600);
        if (!context.end) seen = description;
        const identity = context.end ? `\nCompare with approved first frame "${path.basename(context.first)}". It must be the same individual subject, appearance and setting after the action: ${p.endScene}. This is the completed event, so opening-position requirements do not apply. Use shows:false if identity is uncertain.` : "";
        const result = await lookJSON(stillCheckPrompt({ file: path.basename(png), seen: description, pick: p, shot: s, groups }) + identity, hasBools(["shows", "dark"]), look, dir);
        const ok = result.shows && !result.dark;
        if (!context.end) stillApproved = ok;
        if (ok && !context.end) checkResult = retryWhy ? "retry-pass" : "pass";
        return { ok, why: String(result.why || (result.dark ? "unsafe image" : "subject is not clear")).slice(0, 600) };
      } catch (e) {
        warn(`b-roll: still check unavailable (${String(e.message).split("\n")[0]}); skipping this shot`);
        if (!context.end) checkResult = "unavailable";
        return { ok: false, unavailable: true, why: "still check unavailable after retry" };
      }
    };
    // A wrong still gets one redraw; a failed video gets one re-animation of that same still.
    for (let attempt = 0; attempt < 2; attempt++) {
      if (!canSpend(est.credits)) { warn(`b-roll: clip ${k + 1} skipped; ${est.credits} more credits would exceed the remaining budget`); break; }
      try {
        stillApproved = settings.check === false;
        const still = stillPrompt(p);
        clip = await make({ scene: still, endScene: models.lastFrame ? stillPrompt({ scene: p.endScene }) : undefined, motion: sentMotion, dir, name: `broll-${k + 1}`, ...models, seed, imageRatio: settings.imageRatio, runFn: deps.runFn, fetchFn: deps.fetchFn, sleepFn: deps.sleepFn, check, beforeBuy: (kind, pending) => {
          if (!canSpend(kind === "image" || kind === "endImage" ? est.image : est.video, pending)) throw Object.assign(new Error("per-reel or account budget exhausted"), { code: "BUDGET" });
        } });
        items.push(...clip.items);
      } catch (e) {
        if (e.items) items.push(...e.items);
        if (e.code === "CHECK" && !attempt) {
          retryWhy = String(e.message).split("\n")[0];
          warn(`b-roll: clip ${k + 1} failed its still check (${retryWhy}); trying one more still`);
          continue;
        }
        if (e.code !== "CHECK" && e.code !== "CHECK_UNAVAILABLE" && e.code !== "BUDGET" && stillApproved && e.png && fs.existsSync(e.png)) {
          clip = { png: e.png, last: e.last, failure: String(e.message).split("\n")[0] };
        } else warn(`b-roll: clip ${k + 1} failed (${String(e.message).split("\n")[0]}); dropped`);
      }
      break;
    }
    if (!clip) continue;
    for (let attempt = 0; attempt < 2; attempt++) {
      let moves = { ok: false, why: clip.failure || "video missing" };
      if (clip.mp4) {
        try {
          Object.assign(clip, await trimRunwayClip(clip.mp4, s.duration, { runFn: deps.runFn, dir }));
          moves = await checkRunwayVideo({ file: clip.mp4, shot: s, pick: { ...p, kind: models.kind }, groups, inPoint: clip.inPoint, dir, threshold: settings.motionThreshold ?? 1, deps: { runFn: deps.runFn, claudeLook: look } });
        } catch (e) { moves = { ok: false, why: `clip selection failed: ${String(e.message).split("\n")[0]}` }; }
      }
      if (moves.ok) {
        let sfx;
        if (settings.sfx && p.sound) {
          try {
            if (!canSpend(est.sound)) throw new Error("no remaining budget for synced sound");
            const result = await sound({ file: clip.mp4, out: path.join(dir, `broll-${k + 1}.sfx.wav`), sound: p.sound, seconds: s.duration, seed, runFn: deps.runFn, fetchFn: deps.fetchFn, sleepFn: deps.sleepFn, beforeBuy: (_kind, pending) => {
              if (!canSpend(est.sound, pending)) throw new Error("no remaining budget for synced sound");
            } });
            items.push(...result.items);
            sfx = result.sfx;
          } catch (e) {
            if (e.items) items.push(...e.items);
            warn(`b-roll: synced sound failed (${String(e.message).split("\n")[0]}); keeping the shot silent`);
          }
        }
        shots.push({ ...s, kind: models.kind, seed, imageModel: models.imageModel, videoModel: clip.videoModel || models.videoModel, ...(clip.last ? { last: clip.last } : {}), ...(sfx ? { sfx } : {}), ...(p.sound ? { sound: p.sound } : {}), ...(p.endScene ? { endScene: p.endScene } : {}), file: clip.mp4, full: clip.full, inPoint: clip.inPoint, still: clip.png, video: true, move: "none", motion: sentMotion, scene: p.scene, action: p.action || "the subject moves", check: checkResult, seen, moves });
        break;
      }
      if (attempt || !canSpend(retryCredits)) {
        warn(`b-roll: clip ${k + 1} dropped (${moves.why}${!attempt ? "; no budget for re-animation" : "; re-animation failed"})`);
        break;
      }
      warn(`b-roll: clip ${k + 1} failed (${moves.why}); one re-animation from the same still`);
      try {
        sentMotion = videoMotion(p, { retry: true });
        const r = await animate({ png: clip.png, mp4: clip.png.replace(/\.png$/, ".mp4"), motion: sentMotion, last: clip.last, seed, audio: false, seconds: retrySeconds, videoModel: retryVideoModel, runFn: deps.runFn, fetchFn: deps.fetchFn, sleepFn: deps.sleepFn });
        items.push(...r.items);
        clip = { ...r, png: clip.png, videoModel: retryVideoModel };
      } catch (e) {
        if (e.items) items.push(...e.items);
        warn(`b-roll: clip ${k + 1} re-animation failed (${String(e.message).split("\n")[0]}); dropped`);
        break;
      }
    }
  }
  let after = null;
  try { after = (await org()).creditBalance; } catch {}
  const reelName = path.basename(workDir);
  try { record({ reel: reelName, items, balance: after }); } catch (e) { warn(`usage ledger: ${String(e.message).split("\n")[0]}`); }
  fs.writeFileSync(path.join(workDir, "runway usage.txt"), reelUsageNote(items, { balance: after }));
  writeJSON(planPath, { key, promptVersion: PROMPT_VERSION, shots, usage: items });
  if (shots.length) rememberScenes(shots.map((s) => s.scene));
  log(`b-roll: ${shots.length} Runway clip${shots.length === 1 ? "" : "s"} ready in ${Math.round((Date.now() - t0) / 1000)}s, ${spent()} credits ≈ $${(spent() * 0.01).toFixed(2)}${after != null ? `, balance ${after}` : ""}${shots.map((s) => `\n  ${s.start}s "${s.text}": ${s.scene}`).join("")}`);
  return shots;
}
