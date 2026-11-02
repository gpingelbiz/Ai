import fs from "node:fs";
import path from "node:path";
import { claudeText, claudeLook, firstJSON, hasClaude } from "./claude.mjs";
import { brollCount, brollCandidates, placeBroll, checkPick, spokenInShot, PICTURE_RULES, readRecent, rememberScenes, uniqueScenes } from "./broll.mjs";
import { norm } from "./text.mjs";
import { RUNWAY_STYLE, IMAGE_RULES } from "./codex.mjs";
import { hasRunway, makeClip, animateStill, estimateClip, organization } from "./runway.mjs";
import { recordUsage, reelUsageNote } from "./usage.mjs";
import { log, warn, readJSON, writeJSON, ensureDir, run, r3 } from "./util.mjs";

export const PROMPT_VERSION = "literal-video-v2";

/**
 * B-roll as generated video: Claude picks the lines and writes each literal scene plus one line of camera
 * motion; Runway draws the still, Claude checks it, then Runway animates it into a 5-second clip. Every
 * generation is recorded in the usage ledger, the reel gets a "runway usage.txt", and a per-reel credit cap
 * and the account balance are checked before anything is bought.
 */

export function runwayPicksPrompt({ candidates, transcript, hook, count, spacing = 8, style = "", recent = [], duration = 2.4 }) {
  return [
    "You are a reel editor adding b-roll to a talking-head Instagram reel. The b-roll will be short generated video clips that have to stop a thumb: each one shows the exact thing the line is about, with one strong action. Reply with JSON only; use no tools.",
    `Pick ${count + 2} caption lines, ranked best first (array order is the rank), so we can choose up to ${count} clips. Spread them across the reel, at least ${spacing} seconds apart.`,
    ...PICTURE_RULES.filter((r) => !r.startsWith("Each pick needs")).map((r) => r.replace("from the speaker's world", "from another setting")),
    "Scenes come only from this reel: show the things the speaker names, including analogy and story images, literally. For a line about the speaker’s own day, use only the reel’s own setting (for example, driving to work in a car). Never import a brand world or a setting from another source. A named thing always wins over any world or style.",
    "For each, write these fields:",
    "- `scene`: one or two sentences showing the named thing close and specific, with the light named. The subject must be unmistakable, never a lookalike.",
    "- `shows`: the one to three spoken words naming the subject, copied exactly from this caption line.",
    `- \`duration\`: seconds for this full-screen cutaway, 1.2 to ${Math.min(2.5, duration)}; keep it short enough to finish the action.`,
    "- `action`: the one beat that grabs attention, happening in the first two seconds: something drops, flips, lights up, spills or lands. Hands, arms, boots, a figure from behind or out of focus are fine; never a face, never children, never anyone in distress.",
    "- `motion`: the camera, in one line, decisive: a fast push toward the subject, a crash zoom, a rack focus from the foreground to the subject, a handheld whip that settles. Never a slow drift. Use only positive descriptions of the action and camera in `action` and `motion`; leave exclusions to the still prompt.",
    "Never: empty conference rooms, dinner tables, skylines, generic desks; faces or anyone who could read as the speaker; readable text, numbers, logos or brands; slow motion of nothing.",
    `Look for every scene: ${style || RUNWAY_STYLE}`,
    "Rules for every scene:",
    ...IMAGE_RULES.filter((r) => !/people|hands|fingers|Kill test|bottom third/i.test(r)).map((r) => `- ${r}`),
    "- Keep the subject above the lower third so captions do not cover it.",
    "- No faces, no one who could be mistaken for the speaker; hands, backs and boots are allowed.",
    recent.length ? `Recent reels already used these scenes; pick something clearly different:\n${uniqueScenes(recent).slice(-12).map((s) => `- ${s}`).join("\n")}` : "",
    "",
    `Hook on screen at the start: ${hook || "(none)"}`,
    "",
    "Whole transcript for context:",
    transcript,
    "",
    "Lines you may pick from (number: start time, text):",
    ...candidates.map((c) => `${c.i}: ${c.start.toFixed(1)}s ${c.text}`),
    "",
    'Reply: {"picks":[{"line":<number from the list>,"scene":"...","shows":"...","action":"...","motion":"...","duration":2}]}',
  ].filter(Boolean).join("\n");
}

/** Start on the named word, and leave before the second following caption or any reserved space. */
export function runwayTiming(pick, candidate, groups, { len = 2.4, until = Infinity, busy = [], clear = 1.5 } = {}) {
  const subject = String(pick.shows || "").split(/\s+/).map(norm).filter(Boolean);
  const lineWords = new Set(String(candidate.text).split(/\s+/).map(norm));
  if (!subject.length || subject.some((w) => !lineWords.has(w))) return null;
  const word = candidate.words?.find((w) => norm(w.text) === subject[0]);
  if (candidate.words?.length && !word) return null;
  const start = word?.start ?? candidate.start;
  const requested = Number.isFinite(pick.duration) ? pick.duration : len;
  const end = Math.min(start + Math.max(1.2, Math.min(len, requested)), groups[candidate.i + 2]?.start ?? Infinity, until);
  const duration = end - start;
  if (duration < 1.2 - 0.000001 || busy.some((b) => start < b.start + b.duration + clear && end > b.start - clear)) return null;
  return { start, duration };
}

/** Runway's video prompt carries one positive action and the camera; exclusions belong to the still. */
export function videoMotion(pick, { retry = false } = {}) {
  const positive = (s, fallback) => String(s || "").split(/[.!?;,]+/).map((s) => s.trim())
    .filter((s) => s && !/\b(no|not|never|without|avoid|don't|do not)\b/i.test(s)).join(". ") || fallback;
  const action = positive(pick.action, `${pick.shows || "The subject"} moves`);
  const camera = retry ? "locked camera, subject stays in frame" : positive(pick.motion, "a fast push toward the subject that settles");
  return `${action}. ${retry ? "The movement is large, clear and immediate, completing in the first second. " : "The action completes in the first second. "}Camera: ${camera}.`;
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

/** A moving camera alone is insufficient: the named subject and its action must survive the used part. */
export async function checkRunwayVideo({ file, shot, pick, groups, dir = path.dirname(file), threshold = 1, deps = {} }) {
  const runner = deps.runFn || run, look = deps.claudeLook || claudeLook;
  const tmp = fs.mkdtempSync(path.join(dir, "clip-check-"));
  try {
    // Reference img-3058-runway/broll/broll-1.mp4: mean change 2.7698 over 2.4 s (10 frames),
    // 12.4026 over 4 s (16 frames). A floor of one grey level rejects near-frozen output; vision checks the action.
    const motion = await measureMotion(file, shot.duration, { runFn: runner, dir: tmp });
    const times = [0, shot.duration / 2, Math.max(0, shot.duration - 1 / 30)];
    const frames = [];
    for (let i = 0; i < times.length; i++) {
      const png = path.join(tmp, `${i + 1}.png`);
      await runner("ffmpeg", ["-y", "-loglevel", "error", "-ss", String(times[i]), "-i", file, "-frames:v", "1", "-vf", "scale=360:-2", png], { quiet: true });
      if (!fs.existsSync(png)) throw new Error("video check frame missing");
      frames.push(path.relative(dir, png));
    }
    const result = firstJSON(await look([
      `Read these three frames in time order (start, middle, end of the first ${shot.duration} seconds used by the reel): ${frames.map((f) => JSON.stringify(f)).join(", ")}.`,
      `Caption words during this cutaway: ${JSON.stringify(spokenInShot(shot, groups, { len: shot.duration }))}.`,
      `Is ${JSON.stringify(pick.shows)} intact and clearly visible in ALL three frames? Does this action visibly happen inside this used part: ${JSON.stringify(pick.action || "the subject moves")}? Camera motion alone does not count.`,
      "Could any frame read as a noose, self-harm, death, a weapon used on or pointed at someone, or anyone in danger?",
      'Reply with JSON only: {"shows":true|false,"action":true|false,"dark":true|false,"why":"..."}.',
    ].join("\n"), { cwd: dir, timeoutMs: 180000 }));
    if ([result.shows, result.action, result.dark].some((v) => typeof v !== "boolean")) throw new Error("invalid video look reply");
    const frozen = motion.mean < threshold;
    return { ...result, motion, ok: !frozen && result.shows && result.action && !result.dark, why: frozen ? `frozen clip (mean change ${r3(motion.mean)} < ${threshold})` : String(result.why || "subject or action failed the video check").slice(0, 600) };
  } catch (e) {
    return { ok: false, why: `video check unavailable: ${String(e.message).split("\n")[0]}` };
  } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
}

export async function makeRunwayBroll({ workDir, groups, duration, hook, cta, settings = {}, force = false, busy = [], tail = 1, deps = {} }) {
  const dir = ensureDir(path.join(workDir, "broll"));
  const planPath = path.join(dir, "broll.json");
  const seconds = Math.max(2, Math.min(10, Math.round(settings.videoSeconds ?? 5)));
  const len = Math.max(1.2, Math.min(seconds, settings.duration ?? 2.4));
  const gap = settings.gap ?? 6;
  const max = brollCount(duration, { max: busy.length ? settings.maxWithGraphics ?? 2 : settings.max ?? 3, every: settings.every ?? 12 });
  if (!max) { log("b-roll: reel too short, skipped"); return []; }
  const candidates = brollCandidates(groups, duration, { hook, cta, len: 1.2, busy, tail, clearStart: settings.clearStart ?? 0 });
  const timing = (p, c) => runwayTiming(p, c, groups, { len, until: Math.min(duration - tail, cta?.start ?? Infinity), busy });
  if (!candidates.length) { log("b-roll: no room after the hook, skipped"); return []; }
  const key = `${PROMPT_VERSION}|${JSON.stringify({ candidates, groups, settings, hook, cta, duration, busy, tail })}`;
  if (!force && fs.existsSync(planPath)) {
    const saved = readJSON(planPath);
    if (saved.promptVersion === PROMPT_VERSION && saved.key === key && saved.shots?.length && saved.shots.every((s) => /\.mp4$/i.test(s.file || "") && s.move === "none" && s.moves?.ok && fs.existsSync(s.file))) {
      log(`b-roll: reusing ${saved.shots.length} Runway clip${saved.shots.length === 1 ? "" : "s"} from ${dir} (nothing bought)`);
      return saved.shots;
    }
  }
  const has = deps.hasRunway || hasRunway, claude = deps.claudeText || claudeText, look = deps.claudeLook || claudeLook, make = deps.makeClip || makeClip, animate = deps.animateStill || animateStill, org = deps.organization || organization, record = deps.recordUsage || recordUsage;
  if (!has()) { warn("Runway b-roll needs RUNWAY_API_KEY; rendering without it"); return []; }
  if (!(deps.hasClaude || hasClaude)()) { warn("Runway b-roll needs the Claude Code CLI to pick the scenes; skipped"); return []; }

  // Budget before anything is bought: the per-reel cap and the account balance.
  const est = estimateClip({ seconds, imageRatio: settings.imageRatio || "720:1280", videoModel: settings.videoModel || "gen4_turbo" });
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
    const reply = await claude(runwayPicksPrompt({ candidates, transcript, hook: hook?.text, count: affordable, spacing: len + gap, style: settings.style || "", recent: readRecent(), duration: len }), { timeoutMs: 240000 });
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
  const placed = placeBroll(picks, candidates, { len, gap, max: affordable, ranked: true, timing });
  const byLine = new Map();
  for (const p of picks) if (!byLine.has(p.line)) byLine.set(p.line, p);
  for (const f of fs.readdirSync(dir)) if (/^broll-\d+\.(png|mp4)$/i.test(f)) fs.rmSync(path.join(dir, f), { force: true });
  const shots = [];
  const items = [];
  const budget = Math.min(cap, balance == null ? Infinity : Math.max(0, balance - (settings.keepCredits ?? 0)));
  const spent = (pending = []) => [...items, ...pending].reduce((sum, i) => sum + (i.credits || 0), 0);
  const canSpend = (credits, pending = []) => spent(pending) + credits <= budget;
  for (let k = 0; k < placed.length; k++) {
    const s = placed[k];
    const p = byLine.get(s.line);
    let checkResult = "skipped", seen = "", retryWhy = "";
    let clip = null;
    let sentMotion = videoMotion(p);
    const check = settings.check === false ? undefined : async (png) => {
      try {
        // Ask open first in a separate call: the subject must not cue the picture's description.
        seen = "";
        const open = firstJSON(await look([
          `Read the image ${JSON.stringify(path.basename(png))}.`,
          'What does this picture show? Describe it in a few words. Reply with JSON only: {"seen":"..."}.',
        ].join("\n"), { cwd: dir, timeoutMs: 180000 }));
        if (typeof open.seen !== "string" || !open.seen.trim()) throw new Error("invalid open still reply");
        seen = open.seen.trim().slice(0, 600);
        const result = firstJSON(await look([
          `Read the image ${JSON.stringify(path.basename(png))}. Your open description was ${JSON.stringify(seen)}.`,
          `Does it clearly show ${JSON.stringify(p.shows)} as the main subject, recognisable in one second under the caption ${JSON.stringify(spokenInShot(s, groups, { len: s.duration }))}?`,
          "Could it read as a noose, self-harm, death, a weapon used on or pointed at someone, or anyone in danger? Set dark to true if so.",
          'Reply with JSON only: {"shows":true|false,"dark":true|false,"why":"..."}.',
        ].join("\n"), { cwd: dir, timeoutMs: 180000 }));
        if (typeof result.shows !== "boolean" || typeof result.dark !== "boolean") throw new Error("invalid still check reply");
        const ok = result.shows && !result.dark;
        if (ok) checkResult = retryWhy ? "retry-pass" : "pass";
        return { ok, why: String(result.why || (result.dark ? "unsafe image" : "subject is not clear")).slice(0, 600) };
      } catch (e) {
        warn(`b-roll: still check unavailable (${String(e.message).split("\n")[0]}); accepting the still for animation`);
        checkResult = "skipped";
        return { ok: true };
      }
    };
    // A wrong still gets one redraw; a failed video gets one re-animation of that same still.
    for (let attempt = 0; attempt < 2; attempt++) {
      if (!canSpend(est.credits)) { warn(`b-roll: clip ${k + 1} skipped; ${est.credits} more credits would exceed the remaining budget`); break; }
      try {
        const correction = retryWhy ? ` It must clearly show ${p.shows}; the last picture failed because ${retryWhy}.` : "";
        const still = `${p.scene}${correction} The instant before: ${p.action || "the subject is about to move"}. ${settings.style || RUNWAY_STYLE} No text, no faces.`;
        clip = await make({ scene: still, motion: sentMotion, dir, name: `broll-${k + 1}`, seconds, ratio: settings.videoRatio || "720:1280", imageRatio: settings.imageRatio || "720:1280", videoModel: settings.videoModel || "gen4_turbo", check, beforeBuy: (kind, pending) => {
          if (!canSpend(kind === "image" ? est.image : est.video, pending)) throw Object.assign(new Error("per-reel or account budget exhausted"), { code: "BUDGET" });
        } });
        items.push(...clip.items);
      } catch (e) {
        if (e.items) items.push(...e.items);
        if (e.code === "CHECK" && !attempt) {
          retryWhy = String(e.message).split("\n")[0];
          warn(`b-roll: clip ${k + 1} failed its still check (${retryWhy}); trying one more still`);
          continue;
        }
        if (e.code !== "CHECK" && e.code !== "BUDGET" && e.png && fs.existsSync(e.png)) {
          clip = { png: e.png, failure: String(e.message).split("\n")[0] };
        } else warn(`b-roll: clip ${k + 1} failed (${String(e.message).split("\n")[0]}); dropped`);
      }
      break;
    }
    if (!clip) continue;
    for (let attempt = 0; attempt < 2; attempt++) {
      let moves = { ok: false, why: clip.failure || "video missing" };
      if (clip.mp4) moves = await checkRunwayVideo({ file: clip.mp4, shot: s, pick: p, groups, dir, threshold: settings.motionThreshold ?? 1, deps: { runFn: deps.runFn, claudeLook: look } });
      if (moves.ok) {
        shots.push({ ...s, file: clip.mp4, still: clip.png, video: true, move: "none", motion: sentMotion, scene: p.scene, action: p.action || "the subject moves", check: checkResult, seen, moves });
        break;
      }
      if (attempt || !canSpend(est.video)) {
        warn(`b-roll: clip ${k + 1} dropped (${moves.why}${!attempt ? "; no budget for re-animation" : "; re-animation failed"})`);
        break;
      }
      warn(`b-roll: clip ${k + 1} failed (${moves.why}); one re-animation from the same still`);
      sentMotion = videoMotion(p, { retry: true });
      try {
        const r = await animate({ png: clip.png, mp4: clip.png.replace(/\.png$/, ".mp4"), motion: sentMotion, seconds, ratio: settings.videoRatio || "720:1280", videoModel: settings.videoModel || "gen4_turbo" });
        items.push(...r.items);
        clip = { ...r, png: clip.png };
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
