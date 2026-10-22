import fs from "node:fs";
import path from "node:path";
import { codexExec, codexImage, pool, hasCodex, codexPausedUntil } from "./codex.mjs";
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

/** Caption lines a cutaway may start on: after the hook, with room to finish before the end and the CTA. */
export function brollCandidates(groups, duration, { hook, cta, len = 2.4, lead = 0.5, tail = 1 } = {}) {
  const from = hook ? hook.start + hook.duration + lead : 2.5;
  const until = Math.min(duration - tail, cta ? cta.start : Infinity);
  return groups
    .map((g, i) => ({ i, start: g.start, text: g.text }))
    .filter((c) => c.start >= from && c.start + len <= until);
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
        properties: { line: { type: "integer" }, scene: { type: "string" }, why: { type: "string" } },
        required: ["line", "scene", "why"],
        additionalProperties: false,
      },
    },
  },
  required: ["picks"],
  additionalProperties: false,
};

export function picksPrompt({ candidates, transcript, hook, count }) {
  return [
    "You are a reel editor choosing b-roll for a talking-head Instagram reel. Do not create or edit any files.",
    `Pick ${count} caption lines where cutting away to a still image would make the point land harder, spread across the reel.`,
    "For each, describe the image to generate in one or two sentences: a concrete, literal, cinematic scene that shows what the line says (an object, a place, a moment). Prefer things you can photograph: a phone face-down on a desk, an empty conference room at night, a hand on a door handle.",
    "Rules for scenes: no faces, nobody who could read as the speaker, no readable text, numbers, logos or brands, no clip-art metaphors (no lightbulbs, chess pieces, rockets, puzzle pieces, mountains, arrows).",
    "Skip lines where the speaker is talking about themself in a way only their face can carry.",
    "",
    `Hook on screen at the start: ${hook || "(none)"}`,
    "",
    "Whole transcript for context:",
    transcript,
    "",
    "Lines you may pick from (number: start time, text):",
    ...candidates.map((c) => `${c.i}: ${c.start.toFixed(1)}s ${c.text}`),
    "",
    'Reply with JSON: {"picks":[{"line":<number from the list>,"scene":"...","why":"..."}]}',
  ].join("\n");
}

/**
 * Plan and draw the b-roll for one reel. Writes <workDir>/broll/broll.json and broll-<n>.png and returns the
 * shots with `file` set. Reuses the saved stills when the transcript lines are unchanged. Never throws: any
 * failure returns [] and the reel renders without b-roll.
 */
export async function makeBroll({ workDir, groups, duration, hook, cta, settings = {}, force = false }) {
  const dir = ensureDir(path.join(workDir, "broll"));
  const planPath = path.join(dir, "broll.json");
  const len = settings.duration ?? 2.4;
  const max = brollCount(duration, { max: settings.max ?? 3, every: settings.every ?? 12 });
  if (!max) { log("b-roll: reel too short, skipped"); return []; }
  const candidates = brollCandidates(groups, duration, { hook, cta, len });
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

  const t0 = Date.now();
  let shots;
  try {
    log(`b-roll: Codex is picking ${max} moment${max === 1 ? "" : "s"}…`);
    const transcript = groups.map((g) => g.text).join(" ");
    const reply = await codexExec(picksPrompt({ candidates, transcript, hook: hook?.text, count: max }), { cwd: dir, schema: PICKS_SCHEMA, timeoutMs: 180000 });
    shots = placeBroll(JSON.parse(reply).picks, candidates, { len, gap: settings.gap ?? 4, max });
  } catch (e) {
    warn(`b-roll: could not plan (${String(e.message).split("\n")[0]}); rendering without it`);
    return [];
  }
  if (!shots.length) { warn("b-roll: Codex picked no usable lines; rendering without it"); return []; }

  log(`b-roll: drawing ${shots.length} still${shots.length === 1 ? "" : "s"} with Codex…`);
  const made = await pool(shots, settings.parallel ?? 1, (s, k) => codexImage(s.scene, path.join(dir, `broll-${k + 1}.png`), { aspect: "9:16", style: settings.style || "" }));
  const ok = [];
  made.forEach((r, k) => {
    if (r instanceof Error) warn(`b-roll ${k + 1}: ${String(r.message).split("\n")[0]}`);
    else ok.push({ ...shots[k], file: r });
  });
  if (ok.length) writeJSON(planPath, { key, shots: ok });
  log(`b-roll: ${ok.length} of ${shots.length} ready in ${Math.round((Date.now() - t0) / 1000)}s${ok.map((s) => `\n  ${s.start}s "${s.text}": ${s.scene}`).join("")}`);
  return ok;
}
