import fs from "node:fs";
import path from "node:path";
import { claudeText, firstJSON, hasClaude } from "./claude.mjs";
import { brollCount, brollCandidates, placeBroll, readRecent, rememberScenes } from "./broll.mjs";
import { IMAGE_STYLE, IMAGE_RULES } from "./codex.mjs";
import { hasRunway, makeClip, animateStill, estimateClip, organization } from "./runway.mjs";
import { recordUsage, reelUsageNote } from "./usage.mjs";
import { log, warn, readJSON, writeJSON, ensureDir, r3 } from "./util.mjs";

/**
 * B-roll as generated video: Claude picks the lines and writes each scene (the same documentary rules as the
 * stills) plus one line of camera motion; Runway draws the still and animates it into a 5-second clip. Every
 * generation is recorded in the usage ledger, the reel gets a "runway usage.txt", and a per-reel credit cap
 * and the account balance are checked before anything is bought.
 */

export function runwayPicksPrompt({ candidates, transcript, hook, count, spacing = 8, style = "", recent = [], voice = "" }) {
  return [
    "You are a reel editor adding b-roll to a talking-head Instagram reel. The b-roll will be short generated video clips that have to stop a thumb: each one shows the exact thing the line is about, with one strong action. Reply with JSON only; use no tools.",
    `Pick ${count} caption line${count === 1 ? "" : "s"} where a cutaway makes the point hit harder, spread across the reel, at least ${spacing} seconds apart. Prefer lines with a concrete thing in them (the report, the number, the call, the desk, the truck, the text message) over abstract lines.`,
    "For each, write three fields:",
    "- `scene`: one or two sentences that show the literal subject of that line, in the speaker's world, close and specific, with the light named. Not a mood shot: the viewer must see what the line says. A line about a bad number on a report shows the report on the desk with a hand's shadow over it; a line about slamming the desk shows the fist hitting the desk, coffee jumping; a line about reps watching shows the empty chairs turned toward one chair.",
    "- `action`: the one beat that grabs attention, happening in the first two seconds: something drops, flips, lights up, spills, swings, snaps shut or lands. Hands, arms, boots, a figure from behind or out of focus are fine; never a face, never children. No hitting, punching, slamming, breaking, weapons, anger or anyone in distress: the generator's moderation refuses those and the clip is lost.",
    "- `motion`: the camera, in one line, decisive: a fast push toward the subject, a crash zoom, a rack focus from the foreground to the subject, a handheld whip that settles. Never a slow drift.",
    "Never: empty conference rooms, dinner tables, skylines, generic desks; faces or anyone who could read as the speaker; readable text, numbers, logos or brands; clip-art metaphors (lightbulbs, chess pieces, rockets, puzzles, mountains, arrows); slow motion of nothing.",
    `Look for every scene: ${style || IMAGE_STYLE} High contrast, one hard practical light, deep blacks, the subject big in frame.`,
    voice ? `\nThe speaker's world (use it so every scene is theirs):\n${voice.trim().slice(0, 1200)}` : "",
    "Rules for every scene:",
    ...IMAGE_RULES.filter((r) => !/people|hands|fingers/i.test(r)).map((r) => `- ${r}`),
    "- No faces, no one who could be mistaken for the speaker; hands, backs and boots are allowed.",
    recent.length ? `Recent reels already used these scenes; pick something clearly different:\n${recent.map((s) => `- ${s}`).join("\n")}` : "",
    "",
    `Hook on screen at the start: ${hook || "(none)"}`,
    "",
    "Whole transcript for context:",
    transcript,
    "",
    "Lines you may pick from (number: start time, text):",
    ...candidates.map((c) => `${c.i}: ${c.start.toFixed(1)}s ${c.text}`),
    "",
    'Reply: {"picks":[{"line":<number from the list>,"scene":"...","action":"...","motion":"..."}]}',
  ].filter(Boolean).join("\n");
}

export async function makeRunwayBroll({ workDir, groups, duration, hook, cta, settings = {}, force = false, busy = [], tail = 1, voice = "", deps = {} }) {
  const dir = ensureDir(path.join(workDir, "broll"));
  const planPath = path.join(dir, "broll.json");
  const seconds = Math.max(2, Math.min(10, Math.round(settings.videoSeconds ?? 5)));
  const len = Math.max(1.6, Math.min(seconds, settings.duration ?? 4));
  const gap = settings.gap ?? 6;
  const max = brollCount(duration, { max: busy.length ? settings.maxWithGraphics ?? 2 : settings.max ?? 3, every: settings.every ?? 12 });
  if (!max) { log("b-roll: reel too short, skipped"); return []; }
  const candidates = brollCandidates(groups, duration, { hook, cta, len, busy, tail, clearStart: settings.clearStart ?? 0 });
  if (!candidates.length) { log("b-roll: no room after the hook, skipped"); return []; }
  const key = candidates.map((c) => `${c.start}:${c.text}`).join("|");
  if (!force && fs.existsSync(planPath)) {
    const saved = readJSON(planPath);
    const stillThere = (s) => candidates.some((c) => Math.abs(c.start - s.start) < 0.05 && c.text === s.text);
    if (saved.engine !== "library" && (saved.key === key || saved.shots?.every(stillThere)) && saved.shots?.length && saved.shots.every((s) => s.file && fs.existsSync(s.file))) {
      log(`b-roll: reusing ${saved.shots.length} Runway clip${saved.shots.length === 1 ? "" : "s"} from ${dir} (nothing bought)`);
      return saved.shots;
    }
  }
  const has = deps.hasRunway || hasRunway, claude = deps.claudeText || claudeText, make = deps.makeClip || makeClip, animate = deps.animateStill || animateStill, org = deps.organization || organization, record = deps.recordUsage || recordUsage;
  if (!has()) { warn("Runway b-roll needs RUNWAY_API_KEY; rendering without it"); return []; }
  if (!(deps.hasClaude || hasClaude)()) { warn("Runway b-roll needs the Claude Code CLI to pick the scenes; skipped"); return []; }

  // Budget before anything is bought: the per-reel cap and the account balance.
  const est = estimateClip({ seconds, videoModel: settings.videoModel || "gen4_turbo" });
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
    const reply = await claude(runwayPicksPrompt({ candidates, transcript, hook: hook?.text, count: affordable, spacing: len + gap, style: settings.style || "", recent: readRecent(), voice: settings.world || voice }), { timeoutMs: 240000 });
    picks = (firstJSON(reply).picks || []).filter((p) => Number.isInteger(p.line) && String(p.scene || "").trim());
  } catch (e) {
    warn(`b-roll: ${String(e.message).split("\n")[0]}; rendering without it`);
    return [];
  }
  const placed = placeBroll(picks.map((p) => ({ ...p, file: "x" })), candidates, { len, gap, max: affordable });
  const byLine = new Map(picks.map((p) => [p.line, p]));
  for (const f of fs.readdirSync(dir)) if (/^broll-\d+\.(png|mp4)$/i.test(f)) fs.rmSync(path.join(dir, f), { force: true });
  const shots = [];
  const items = [];
  for (let k = 0; k < placed.length; k++) {
    const s = placed[k];
    const p = byLine.get(s.line);
    try {
      // The still shows the scene at the moment before the action; the video prompt carries the action and the camera.
      const still = `${p.scene} The instant before: ${p.action || "the subject is about to move"}. Cinematic, high contrast, the subject large in frame, no text.`;
      const move = `${p.action || "the subject moves"}. Camera: ${p.motion || "a fast push toward the subject that settles"}. The action lands in the first two seconds; no text, no faces.`;
      const r = await make({ scene: still, motion: move, dir, name: `broll-${k + 1}`, seconds, ratio: settings.videoRatio || "720:1280", imageRatio: settings.imageRatio || "720:1280", videoModel: settings.videoModel || "gen4_turbo" });
      items.push(...r.items);
      shots.push({ ...s, file: r.mp4, still: r.png, motion: "none", scene: p.scene });
    } catch (e) {
      if (e.items) items.push(...e.items);
      // A refused video gets one more try from its own still with gentler motion (no new image is bought).
      if (e.png && fs.existsSync(e.png) && /SAFETY/.test(String(e.code || e.message))) {
        try {
          warn(`b-roll: clip ${k + 1} was refused by moderation; one more try with gentler motion`);
          const r2 = await animate({ png: e.png, mp4: e.png.replace(/\.png$/, ".mp4"), motion: "Gentle, natural movement in the scene: light shifts, something small settles. Camera: a steady push toward the subject. No people moving, no faces, no text.", seconds, ratio: settings.videoRatio || "720:1280", videoModel: settings.videoModel || "gen4_turbo" });
          items.push(...r2.items);
          shots.push({ ...s, file: r2.mp4, still: e.png, motion: "none", scene: p.scene });
          continue;
        } catch (e2) { if (e2.items) items.push(...e2.items); warn(`b-roll: clip ${k + 1} refused again (${String(e2.message).split("\n")[0]}); keeping its still`); }
      } else warn(`b-roll: clip ${k + 1} failed (${String(e.message).split("\n")[0]})${e.png ? "; keeping its still" : ""}`);
      if (e.png && fs.existsSync(e.png)) shots.push({ ...s, file: e.png, motion: "in", scene: p.scene });
    }
  }
  let after = null;
  try { after = (await org()).creditBalance; } catch {}
  const reelName = path.basename(workDir);
  try { record({ reel: reelName, items, balance: after }); } catch (e) { warn(`usage ledger: ${String(e.message).split("\n")[0]}`); }
  fs.writeFileSync(path.join(workDir, "runway usage.txt"), reelUsageNote(items, { balance: after }));
  if (shots.length) { writeJSON(planPath, { key, shots, usage: items }); rememberScenes(shots.map((s) => s.scene)); }
  const spent = items.filter((i) => i.ok).reduce((a, i) => a + i.credits, 0);
  log(`b-roll: ${shots.length} Runway clip${shots.length === 1 ? "" : "s"} ready in ${Math.round((Date.now() - t0) / 1000)}s, ${spent} credits ≈ $${(spent * 0.01).toFixed(2)}${after != null ? `, balance ${after}` : ""}${shots.map((s) => `\n  ${s.start}s "${s.text}": ${s.scene}`).join("")}`);
  return shots;
}
