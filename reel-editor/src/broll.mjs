import fs from "node:fs";
import path from "node:path";
import { codexExec, hasCodex, codexPausedUntil, imageInstructions, savedImage } from "./codex.mjs";
import { log, warn, writeJSON, readJSON, ensureDir, r3 } from "./util.mjs";

/**
 * B-roll: Codex reads the finished transcript, picks the lines a picture would land on, and draws a still for each.
 * The render cuts to each still for a couple of seconds with slow motion while the voice keeps playing and the
 * captions stay on top. Never during the hook, never in the last second, never over the CTA.
 */

/** How many cutaways a reel of this length gets: about one per 12 seconds after the hook, 1 to `max`. */
export function brollCount(duration, { max = 3, every = 12 } = {}) {
  return Math.max(0, Math.min(max, Math.floor((duration - 4) / every)));
}

/**
 * Caption lines a cutaway may start on: after the hook, with room to finish before the end and the CTA, and
 * at least `clear` seconds away from anything already cut in (`busy`: the graphic cards).
 */
export function brollCandidates(groups, duration, { hook, cta, len = 2.4, lead = 0.5, tail = 1, busy = [], clear = 1.5 } = {}) {
  const from = hook ? hook.start + hook.duration + lead : 2.5;
  const until = Math.min(duration - tail, cta ? cta.start : Infinity);
  return groups
    .map((g, i) => ({ i, start: g.start, text: g.text }))
    .filter((c) => c.start >= from && c.start + len <= until)
    .filter((c) => !busy.some((b) => c.start < b.start + b.duration + clear && c.start + len > b.start - clear));
}

/** Turn Codex's picks into timed shots: real candidates only, in order, at least `gap` seconds apart. */
export function placeBroll(picks, candidates, { len = 2.4, gap = 4, max = 3 } = {}) {
  const byLine = new Map(candidates.map((c) => [c.i, c]));
  const shots = [];
  const sorted = (picks || [])
    .filter((p) => byLine.has(p.line) && String(p.scene || "").trim())
    .sort((a, b) => byLine.get(a.line).start - byLine.get(b.line).start);
  for (const p of sorted) {
    const c = byLine.get(p.line);
    const prev = shots[shots.length - 1];
    if (prev && c.start < prev.start + prev.duration + gap) continue;
    shots.push({ line: p.line, start: r3(c.start), duration: len, text: c.text, scene: String(p.scene).trim() });
    if (shots.length >= max) break;
  }
  const motions = ["in", "left", "out", "right"];
  return shots.map((s, k) => ({ ...s, motion: motions[k % motions.length] }));
}

export const PICKS_SCHEMA = {
  type: "object",
  properties: {
    picks: {
      type: "array",
      items: {
        type: "object",
        properties: { line: { type: "integer" }, scene: { type: "string" }, file: { type: "string" } },
        required: ["line", "scene", "file"],
        additionalProperties: false,
      },
    },
  },
  required: ["picks"],
  additionalProperties: false,
};

export function picksPrompt({ candidates, transcript, hook, count, spacing = 6.4, style = "" }) {
  return [
    "You are a reel editor adding b-roll to a talking-head Instagram reel.",
    `First pick ${count} caption lines where cutting away to a still image would make the point land harder, spread across the reel, at least ${spacing} seconds apart.`,
    "For each, describe the image in one or two sentences: a concrete, literal, cinematic scene that shows what the line says (an object, a place, a moment). Prefer things you can photograph: a phone face-down on a desk, an empty conference room at night, a hand on a door handle.",
    "Scenes never show faces or anyone who could read as the speaker, readable text, numbers, logos or brands, or clip-art metaphors (lightbulbs, chess pieces, rockets, puzzle pieces, mountains, arrows).",
    "Skip lines where the speaker is talking about themself in a way only their face can carry.",
    `Name the images broll-1.png, broll-2.png and so on, in time order.`,
    imageInstructions({ aspect: "9:16", style }),
    "",
    `Hook on screen at the start: ${hook || "(none)"}`,
    "",
    "Whole transcript for context:",
    transcript,
    "",
    "Lines you may pick from (number: start time, text):",
    ...candidates.map((c) => `${c.i}: ${c.start.toFixed(1)}s ${c.text}`),
    "",
    'When the images are saved, reply with JSON: {"picks":[{"line":<number from the list>,"scene":"...","file":"broll-1.png"}]}',
  ].join("\n");
}

/**
 * Plan and draw the b-roll for one reel in ONE Codex session. Writes <workDir>/broll/broll.json and
 * broll-<n>.png and returns the shots with `file` set. Reuses the saved stills when the transcript lines are
 * unchanged. Never throws: any failure returns [] and the reel renders without b-roll.
 */
export async function makeBroll({ workDir, groups, duration, hook, cta, settings = {}, force = false, busy = [] }) {
  const dir = ensureDir(path.join(workDir, "broll"));
  const planPath = path.join(dir, "broll.json");
  const len = settings.duration ?? 2.4;
  const gap = settings.gap ?? 4;
  // With graphic cards in the reel, photos are an accent: fewer of them, in the gaps.
  const max = brollCount(duration, { max: busy.length ? settings.maxWithGraphics ?? 2 : settings.max ?? 3, every: settings.every ?? 12 });
  if (!max) { log("b-roll: reel too short, skipped"); return []; }
  const candidates = brollCandidates(groups, duration, { hook, cta, len, busy });
  if (!candidates.length) { log("b-roll: no room after the hook, skipped"); return []; }
  const key = candidates.map((c) => `${c.i}@${c.start}:${c.text}`).join("|");

  if (!force && fs.existsSync(planPath)) {
    const saved = readJSON(planPath);
    if (saved.key === key && saved.shots?.length && saved.shots.every((s) => s.file && fs.existsSync(s.file))) {
      log(`b-roll: reusing ${saved.shots.length} still${saved.shots.length === 1 ? "" : "s"} from ${dir}`);
      return saved.shots;
    }
  }
  if (!hasCodex()) { warn("b-roll needs the Codex CLI (codex) signed in; skipped"); return []; }
  if (codexPausedUntil()) { warn(`b-roll: Codex is paused after a rate limit until ${new Date(codexPausedUntil()).toLocaleTimeString()}; rendering without it`); return []; }

  for (const f of fs.readdirSync(dir)) if (/^broll-\d+\.(png|jpe?g|webp)$/i.test(f)) fs.rmSync(path.join(dir, f), { force: true });
  const t0 = Date.now();
  let picks;
  try {
    log(`b-roll: Codex is picking ${max} moment${max === 1 ? "" : "s"} and drawing the stills…`);
    const transcript = groups.map((g) => g.text).join(" ");
    const reply = await codexExec(picksPrompt({ candidates, transcript, hook: hook?.text, count: max, spacing: len + gap, style: settings.style || "" }), { cwd: dir, schema: PICKS_SCHEMA, timeoutMs: 600000 });
    picks = JSON.parse(reply).picks || [];
  } catch (e) {
    warn(`b-roll: ${String(e.message).split("\n")[0]}; rendering without it`);
    return [];
  }
  // Keep the picks whose image exists, then place them (real lines, in order, spaced).
  const drawn = picks.map((p) => ({ ...p, path: savedImage(dir, path.basename(String(p.file || ""))) })).filter((p) => p.path);
  const files = new Map(drawn.map((p) => [p.line, p.path]));
  const shots = placeBroll(drawn, candidates, { len, gap, max }).map((s) => ({ ...s, file: files.get(s.line) }));
  if (shots.length) writeJSON(planPath, { key, shots });
  if (shots.length < picks.length) warn(`b-roll: ${picks.length - shots.length} of ${picks.length} picks had no image or no room`);
  log(`b-roll: ${shots.length} still${shots.length === 1 ? "" : "s"} ready in ${Math.round((Date.now() - t0) / 1000)}s${shots.map((s) => `\n  ${s.start}s "${s.text}": ${s.scene}`).join("")}`);
  return shots;
}
