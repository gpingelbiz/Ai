import fs from "node:fs";
import path from "node:path";
import { codexExec, hasCodex, codexPausedUntil, imageInstructions, savedImage } from "./codex.mjs";
import os from "node:os";
import { log, warn, writeJSON, readJSON, ensureDir, r3 } from "./util.mjs";
import { norm } from "./text.mjs";

export const PROMPT_VERSION = "literal-stills-v2";

/** Scenes drawn for recent reels, so the next reel does not get the same empty conference room again. */
// REEL_CACHE gives a client its own scene history, so its b-roll never steers off (or into) Greg's scenes.
export const recentFile = (env = process.env) => env.REEL_BROLL_RECENT || path.join(env.REEL_CACHE || path.join(os.homedir(), ".cache", "reel-editor"), "broll-recent.json");
export function readRecent(file = recentFile()) {
  try { return uniqueScenes(JSON.parse(fs.readFileSync(file, "utf8")).scenes || []); } catch { return []; }
}
export const uniqueScenes = (scenes) => [...new Set(scenes.map((s) => String(s).replace(/\s+/g, " ").trim()).filter(Boolean).reverse())].reverse();
export function rememberScenes(scenes, file = recentFile(), keep = 24) {
  const list = uniqueScenes([...readRecent(file), ...scenes]).slice(-keep);
  try { ensureDir(path.dirname(file)); fs.writeFileSync(file, JSON.stringify({ scenes: list }, null, 2) + "\n"); } catch {}
  return list;
}

/**
 * B-roll: Codex reads the finished transcript, picks the lines a picture would land on, and draws a still for each.
 * The render cuts to each still for a couple of seconds with slow motion while the voice keeps playing and the
 * captions stay on top. Never during the hook, never in the last second, never over the CTA.
 */

/** How many cutaways a reel of this length gets: about one per 12 seconds after the hook, 1 to `max`. A short
 *  reel (8 s and up) still gets one, so a 10-second clip in the b-roll folder does not come back plain. */
export function brollCount(duration, { max = 3, every = 12 } = {}) {
  const n = Math.max(0, Math.min(max, Math.floor((duration - 4) / every)));
  return n === 0 && duration >= 8 && max >= 1 ? 1 : n;
}

/**
 * Caption lines a cutaway may start on: after the hook, with room to finish before the end and the CTA, and
 * at least `clear` seconds away from anything already cut in (`busy`: the graphic cards).
 */
export function brollCandidates(groups, duration, { hook, cta, len = 2.4, lead = 0.5, tail = 1, busy = [], clear = 1.5, clearStart = 0 } = {}) {
  // clearStart: nothing cuts away from the speaker before this second (the one-take look keeps the face up front).
  const from = Math.max(hook ? hook.start + hook.duration + lead : 2.5, clearStart || 0);
  const until = Math.min(duration - tail, cta ? cta.start : Infinity);
  return groups
    .map((g, i) => ({ i, start: g.start, text: g.text, ...(g.words?.length ? { words: g.words } : {}) }))
    .filter((c) => c.start >= from && c.start + len <= until)
    .filter((c) => !busy.some((b) => c.start < b.start + b.duration + clear && c.start + len > b.start - clear));
}

/** Choose spaced picks in time order (or rank order), then return timed shots in time order. */
export function placeBroll(picks, candidates, { len = 2.4, gap = 4, max = 3, ranked = false, timing } = {}) {
  if (max <= 0) return [];
  const byLine = new Map(candidates.map((c) => [c.i, c]));
  const shots = [];
  const sorted = (picks || [])
    .filter((p) => byLine.has(p.line) && String(p.scene || "").trim());
  if (!ranked) sorted.sort((a, b) => byLine.get(a.line).start - byLine.get(b.line).start);
  for (const p of sorted) {
    const c = byLine.get(p.line);
    const t = timing ? timing(p, c) : { start: c.start, duration: len };
    if (!t || !(t.duration > 0)) continue;
    if (shots.some((s) => t.start < s.start + s.duration + gap && t.start + t.duration + gap > s.start)) continue;
    shots.push({ line: p.line, start: r3(t.start), duration: r3(t.duration), text: c.text, scene: String(p.scene).trim(), ...(p.shows ? { shows: p.shows } : {}), ...(p.rank ? { rank: p.rank } : {}) });
    if (shots.length >= max) break;
  }
  const motions = ["in", "left", "out", "right"];
  return shots.sort((a, b) => a.start - b.start).map((s, k) => ({ ...s, motion: motions[k % motions.length] }));
}

/** Use word times when available, so a noun outside the shot cannot justify its picture. */
export function spokenInShot(candidate, groups, { len = 2.4 } = {}) {
  const until = candidate.start + len + 0.5;
  return groups.flatMap((g) => g.words?.length ? g.words : [{ start: g.start, text: g.text }])
    .filter((w) => w.start >= candidate.start && w.start <= until).map((w) => w.text).join(" ");
}

/** Reject stand-ins before either engine places a shot. */
// Words that never name the thing a picture shows ("a", "the", "coming", "just").
const SUBJECT_STOP = new Set("a an the some my your his her their our this that these those in on at to of into onto with i i'm me you it it's is are was going coming just".split(" "));

/**
 * The subject a pick names. Claude often writes `shows` as a phrase ("a snake coming down", "going to the jungle",
 * "a two by four"); the subject is the run of those words its own scene also names, without leading articles or
 * verbs, at most three words ("snake", "jungle", "two by four").
 */
export function subjectWords(shows, scene = "") {
  const words = String(shows || "").split(/\s+/).map(norm).filter(Boolean);
  const named = new Set(String(scene || "").split(/[^\p{L}\p{N}']+/u).map(norm).filter(Boolean));
  // Runs of words the scene also names; the run holding the longest such word is the subject.
  const runs = [];
  words.forEach((w, i) => {
    const kept = named.has(w) && !SUBJECT_STOP.has(w) || (named.has(w) && runs.at(-1)?.end === i - 1 && named.has(words[i + 1] || ""));
    if (!kept) return;
    if (runs.at(-1)?.end === i - 1) runs.at(-1).end = i; else runs.push({ start: i, end: i });
  });
  if (!runs.length) return words.filter((w) => !SUBJECT_STOP.has(w)).slice(0, 3);
  const longest = (r) => Math.max(...words.slice(r.start, r.end + 1).map((w) => w.length));
  const best = runs.reduce((a, b) => (longest(b) > longest(a) ? b : a));
  return words.slice(best.start, best.end + 1).slice(0, 3);
}

export function checkPick(pick, candidate, groups, { len = 2.4 } = {}) {
  const words = (s) => String(s || "").split(/\s+/).map(norm).filter(Boolean);
  const shows = subjectWords(pick.shows, pick.scene);
  if (!shows.length) return "shows missing";
  if (!candidate) return "line is not a candidate";
  const spoken = new Set(words(spokenInShot(candidate, groups, { len })));
  const missing = shows.find((w) => !spoken.has(w));
  if (missing) return `shows word not spoken: ${missing}`;
  const noun = shows.reduce((a, b) => b.length > a.length ? b : a);
  // Split the scene on any non-letter so "a wooden two-by-four" names "four".
  const sceneWords = String(pick.scene || "").split(/[^\p{L}\p{N}']+/u).map(norm).filter(Boolean);
  if (!sceneWords.includes(noun)) return `scene does not contain ${noun}`;
  const dark = String(pick.scene || "").match(/\b(rope|cord|strap|noose|lasso|cable|chain)s?\b/i);
  if (dark) return `dark-read word: ${dark[0]}`;
  // A weapon line ("bring a knife, kill the snake") stays on the speaker: no cutaway of the weapon at all.
  const weapon = `${shows.join(" ")} ${pick.scene || ""}`.match(/\b(knife|knives|gun|guns|pistol|rifle|sword|swords|machete|blade|blades|axe|dagger)\b/i);
  if (weapon) return `weapon stays on the speaker: ${weapon[0]}`;
  return null;
}

export const PICTURE_RULES = [
  "The picture is what the words say. Pick lines whose spoken words name something a viewer can see: an animal, an object, a place or an action. Show THAT thing big and unmistakable; a cold viewer with the caption under it must get it in under one second.",
  "When the speaker paints an image (an analogy, a joke, a story: a jungle, a snake, a coconut, quicksand), show the named subject literally with harmless behaviour: a green snake sliding down a broad jungle rock. Never swap it for a stand-in from the speaker's world: never a rope for a snake, never tape for a coconut, never a box cutter for a knife.",
  "Clip-art symbols the speaker never said are banned (a lightbulb for 'idea'); an image the speaker names is not clip art.",
  "A quick spoken list of images (a snake, an ape, a lion) can get one short shot per item if they are far enough apart.",
  "Dark-read rule: never a rope, cord, strap, cable or chain hanging or looped, nothing at a neck or throat, nothing that could read as a noose, self-harm, death or someone in danger, even with the caption under it.",
  "Moderation: no weapon used on or pointed at anyone, no attack, no injury; a tool can lie on a surface or be held in a hand (a knife in a leather sheath on a log, a hand gripping a plank of wood).",
  "Each pick needs `shows`: one to three words copied exactly from the spoken words of that line or the next caption line, naming the thing the picture shows. The `scene` must name the same thing.",
];

/**
 * The "full-split" layout's longer beat: with two or more cutaways, the one with the most clear time after it is
 * held for `hold` seconds as a split (picture on top, speaker below), the rest stay short full-screen cutaways.
 * Clear time ends `gap` before the next cutaway, `clear` before the next card, at the CTA and `tail` before the end.
 * The held shot keeps `baseDuration`, so a split that does not fit can go back to a normal cutaway.
 */
export function holdForSplit(shots = [], { duration, cta, busy = [], tail = 1, gap = 4, clear = 1.5, hold = 5, clipSeconds = 5 } = {}) {
  if (shots.length < 2 || !(hold > 0)) return shots;
  const until = Math.min(duration - tail, cta ? cta.start : Infinity);
  const room = shots.map((s, k) => {
    const next = shots[k + 1] ? shots[k + 1].start - gap : Infinity;
    const card = Math.min(...busy.filter((b) => b.start + b.duration > s.start).map((b) => b.start - clear), Infinity);
    return Math.min(until, next, card) - s.start;
  });
  // A generated clip (Runway) is only so long; a still can be held any length.
  const want = (s) => (/\.mp4$/i.test(String(s.file || "")) ? Math.min(hold, clipSeconds, s.moves ? s.duration : Infinity) : hold);
  const best = room.map((r, k) => ({ k, r })).filter(({ k, r }) => want(shots[k]) > shots[k].duration && r >= want(shots[k])).sort((a, b) => b.r - a.r || b.k - a.k)[0];
  if (!best) return shots;
  return shots.map((s, k) => (k === best.k ? { ...s, hold: true, baseDuration: s.duration, duration: r3(want(s)) } : s));
}

export const PICKS_SCHEMA = {
  type: "object",
  properties: {
    picks: {
      type: "array",
      items: {
        type: "object",
        properties: { line: { type: "integer" }, scene: { type: "string" }, shows: { type: "string" }, file: { type: "string" } },
        required: ["line", "scene", "shows", "file"],
        additionalProperties: false,
      },
    },
  },
  required: ["picks"],
  additionalProperties: false,
};

export function picksPrompt({ candidates, transcript, hook, count, spacing = 6.4, style = "", recent = [], aspect = "9:16", world = "" }) {
  return [
    "You are a reel editor adding b-roll to a talking-head Instagram reel.",
    `First pick ${count} caption lines where cutting away to a still image would make the point land harder, spread across the reel, at least ${spacing} seconds apart.`,
    ...PICTURE_RULES,
    "For each, describe the image in one or two sentences, close and specific. Say what the light is and where it comes from.",
    world ? `The speaker's world (only for lines about their own life and work; never use it to replace an image they name): ${world}` : "",
    "Never: empty conference rooms, dinner tables, skylines, empty offices, generic desks (they read as stock photos); faces or anyone who could read as the speaker; readable text, numbers, logos or brands.",
    "Skip lines where the speaker is talking about themself in a way only their face can carry.",
    recent.length ? `Recent reels already used these scenes; pick something clearly different (another object, place or moment):\n${uniqueScenes(recent).slice(-12).map((s) => `- ${s}`).join("\n")}` : "",
    `Name the images broll-1.png, broll-2.png and so on, in time order.`,
    imageInstructions({ aspect, style }),
    "",
    `Hook on screen at the start: ${hook || "(none)"}`,
    "",
    "Whole transcript for context:",
    transcript,
    "",
    "Lines you may pick from (number: start time, text):",
    ...candidates.map((c) => `${c.i}: ${c.start.toFixed(1)}s ${c.text}`),
    "",
    'When the images are saved, reply with JSON: {"picks":[{"line":<number from the list>,"scene":"...","shows":"...","file":"broll-1.png"}]}',
  ].join("\n");
}

/**
 * Plan and draw the b-roll for one reel in ONE Codex session. Writes <workDir>/broll/broll.json and
 * broll-<n>.png and returns the shots with `file` set. Reuses the saved stills when the transcript lines are
 * unchanged. Never throws: any failure returns [] and the reel renders without b-roll.
 */
export async function makeBroll({ workDir, groups, duration, hook, cta, settings = {}, force = false, busy = [], tail = 1, deps = {} }) {
  const dir = ensureDir(path.join(workDir, "broll"));
  const planPath = path.join(dir, "broll.json");
  const len = Math.max(1.6, Math.min(2.4, settings.duration ?? 2));
  const gap = settings.gap ?? 4;
  // With graphic cards in the reel, photos are an accent: fewer of them, in the gaps.
  const max = brollCount(duration, { max: busy.length ? settings.maxWithGraphics ?? 2 : settings.max ?? 3, every: settings.every ?? 12 });
  if (!max) { log("b-roll: reel too short, skipped"); return []; }
  const candidates = brollCandidates(groups, duration, { hook, cta, len, busy, tail, clearStart: settings.clearStart ?? 0 });
  if (!candidates.length) { log("b-roll: no room after the hook, skipped"); return []; }
  const key = `${PROMPT_VERSION}|${candidates.map((c) => `${c.i}@${c.start}:${c.text}`).join("|")}`;

  if (!force && fs.existsSync(planPath)) {
    const saved = readJSON(planPath);
    // Reuse while the lines the stills were drawn for are still there (a new hook hides different caption lines,
    // which must not cost another Codex session).
    const stillThere = (s) => candidates.some((c) => Math.abs(c.start - s.start) < 0.05 && c.text === s.text);
    if (saved.promptVersion === PROMPT_VERSION && (saved.key === key || saved.shots?.every(stillThere)) && saved.shots?.length && saved.shots.every((s) => s.file && fs.existsSync(s.file))) {
      log(`b-roll: reusing ${saved.shots.length} still${saved.shots.length === 1 ? "" : "s"} from ${dir}`);
      return saved.shots;
    }
  }
  const has = deps.hasCodex || hasCodex, paused = deps.codexPausedUntil || codexPausedUntil, exec = deps.codexExec || codexExec;
  if (!has()) { warn("b-roll needs the Codex CLI (codex) signed in; skipped"); return []; }
  const until = paused();
  if (until) { warn(`b-roll: Codex is paused after a rate limit until ${new Date(until).toLocaleTimeString()}; rendering without it`); return []; }

  for (const f of fs.readdirSync(dir)) if (/^broll-\d+\.(png|jpe?g|webp)$/i.test(f)) fs.rmSync(path.join(dir, f), { force: true });
  const t0 = Date.now();
  let picks;
  try {
    log(`b-roll: Codex is picking ${max} moment${max === 1 ? "" : "s"} and drawing the stills…`);
    const transcript = groups.map((g) => g.text).join(" ");
    const reply = await exec(picksPrompt({ candidates, transcript, hook: hook?.text, count: max, spacing: len + gap, style: settings.style || "", recent: readRecent(), aspect: settings.aspect || "9:16", world: settings.worldInPrompt ? settings.world || "" : "" }), { cwd: dir, schema: PICKS_SCHEMA, timeoutMs: 600000 });
    picks = JSON.parse(reply).picks || [];
  } catch (e) {
    warn(`b-roll: ${String(e.message).split("\n")[0]}; rendering without it`);
    return [];
  }
  // Keep the picks whose image exists, then place them (real lines, in order, spaced).
  const drawn = picks.filter((p) => {
    const why = checkPick(p, candidates.find((c) => c.i === p.line), groups, { len });
    if (why) warn(`b-roll: rejected line ${p.line}: ${why}`);
    return !why;
  }).map((p) => ({ ...p, path: savedImage(dir, path.basename(String(p.file || ""))) })).filter((p) => p.path);
  const files = new Map(drawn.map((p) => [p.line, p.path]));
  const shots = placeBroll(drawn, candidates, { len, gap, max }).map((s) => ({ ...s, file: files.get(s.line) }));
  if (shots.length) { writeJSON(planPath, { key, promptVersion: PROMPT_VERSION, shots }); rememberScenes(shots.map((s) => s.scene)); }
  if (shots.length < picks.length) warn(`b-roll: ${picks.length - shots.length} of ${picks.length} picks had no image or no room`);
  log(`b-roll: ${shots.length} still${shots.length === 1 ? "" : "s"} ready in ${Math.round((Date.now() - t0) / 1000)}s${shots.map((s) => `\n  ${s.start}s "${s.text}": ${s.scene}`).join("")}`);
  return shots;
}
