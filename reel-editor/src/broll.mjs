import fs from "node:fs";
import path from "node:path";
import { codexExec, hasCodex, codexPausedUntil, savedImage } from "./codex.mjs";
import os from "node:os";
import { log, warn, writeJSON, readJSON, ensureDir, r3 } from "./util.mjs";
import { norm } from "./text.mjs";
import { makeRunwayBroll, runwayPicksPrompt, runwayTiming, validateBrollPicks, placePlannedBroll, STILL_STYLE, PICKS_REPLY } from "./broll-runway.mjs";
import { conformStill, hasRunway } from "./runway.mjs";
import { createStockSearch, makeStockClip } from "./broll-stock.mjs";
import { findLibraryClip, reviewMovingClip, writeBrollCredits } from "./broll-library.mjs";

export const PROMPT_VERSION = "literal-codex-v9";

let testCache;
/** Tests get one disposable scene history and clip bank per worker, unless they supply explicit paths. */
export function brollTestCache() {
  if (!testCache) {
    testCache = fs.mkdtempSync(path.join(os.tmpdir(), "reel-broll-test-"));
    process.once("exit", () => fs.rmSync(testCache, { recursive: true, force: true }));
  }
  return testCache;
}

/** Keep each route step on one line, including CLI errors, without exposing credentials. */
export function brollStep(pick, message, deps = {}) {
  let safe = String(message);
  for (const [name, value] of Object.entries({ ...process.env, ...deps.env })) {
    if (/key|token|secret|password/i.test(name) && value) {
      for (const secret of new Set([value, encodeURIComponent(value)])) safe = safe.replaceAll(secret, "[redacted]");
    }
  }
  safe = safe.replace(/\s+/g, " ").trim();
  (deps.logFn || log)(`b-roll: line ${pick.line}: ${safe}`);
  deps.onBrollStep?.(pick, safe);
}

/** Scenes drawn for recent reels, so the next reel does not get the same empty conference room again. */
// REEL_CACHE gives a client its own scene history, so its b-roll never steers off (or into) Greg's scenes.
export const recentFile = (env = process.env) => env.REEL_BROLL_RECENT || path.join(env.NODE_TEST_CONTEXT || process.env.NODE_TEST_CONTEXT ? brollTestCache() : env.REEL_CACHE || path.join(os.homedir(), ".cache", "reel-editor"), "broll-recent.json");
export function readRecent(file = recentFile()) {
  try { return uniqueScenes(JSON.parse(fs.readFileSync(file, "utf8")).scenes || []); } catch { return []; }
}
export const uniqueScenes = (scenes) => [...new Set(scenes.map((s) => String(s).replace(/\s+/g, " ").trim()).filter(Boolean).reverse())].reverse();
export function rememberScenes(scenes, file = recentFile(), keep = 24) {
  const list = uniqueScenes([...readRecent(file), ...scenes]).slice(-keep);
  try { ensureDir(path.dirname(file)); fs.writeFileSync(file, JSON.stringify({ scenes: list }, null, 2) + "\n"); } catch {}
  return list;
}

/** Codex chooses literal scenes and draws their first frames; moving shots share the Runway pipeline. */

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

/** Whole-word inflections only; a snakeskin boot still cannot stand in for a snake. */
export function subjectStem(word) {
  const w = norm(word);
  if (["drive", "drives", "driving", "driven", "drove"].includes(w)) return "drive";
  if (["fly", "flies", "flying", "flight", "flights", "flew", "flown"].includes(w)) return "fly";
  if (w.length > 4 && w.endsWith("ies")) return `${w.slice(0, -3)}y`;
  const singular = /(?:ches|shes|xes|zes|sses)$/.test(w) ? w.slice(0, -2) : w.length > 3 && !/(?:ss|us|is)$/.test(w) ? w.replace(/s$/, "") : w;
  const stem = singular.length > 4 && /(?:ing|ed)$/.test(singular) ? singular.replace(/(?:ing|ed)$/, "").replace(/([b-df-hj-np-tv-z])\1$/, "$1") : singular;
  return stem.length > 3 ? stem.replace(/e$/, "") : stem;
}

const SETTING_WORDS = [
  ["drive", "car", "highway", "road", "desert", "traffic"],
  ["fly", "airplane", "plane", "jet", "airport", "runway", "sky"],
  ["middle nowhere", "remote", "lonely", "desert", "backcountry", "wilderness"],
  ["mountain", "hill", "slope", "ridge", "peak", "valley"],
];

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
  if (!runs.length) {
    const first = words.findIndex((w) => !SUBJECT_STOP.has(w));
    const last = words.findLastIndex((w) => !SUBJECT_STOP.has(w));
    return first < 0 ? [] : words.slice(first, last + 1).slice(0, 3);
  }
  const longest = (r) => Math.max(...words.slice(r.start, r.end + 1).map((w) => w.length));
  const best = runs.reduce((a, b) => (longest(b) > longest(a) ? b : a));
  return words.slice(best.start, best.end + 1).slice(0, 3);
}

export function checkPick(pick, candidate, groups, { len = 2.4, stock = false } = {}) {
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
  const sceneStems = new Set(sceneWords.map(subjectStem));
  const contains = (phrase) => {
    const stems = words(phrase).map(subjectStem);
    return stems.length && sceneWords.some((_, i) => stems.every((w, k) => subjectStem(sceneWords[i + k] || "") === w));
  };
  const synonyms = stock && Array.isArray(pick.stockSynonyms) ? pick.stockSynonyms.filter((s) => typeof s === "string").slice(0, 3) : [];
  const setting = stock && pick.kind === "ambient" && SETTING_WORDS.some(([anchor, ...settingWords]) =>
    anchor.split(" ").every((w) => shows.map(subjectStem).includes(subjectStem(w))) && settingWords.some((w) => sceneStems.has(subjectStem(w))));
  if (!sceneStems.has(subjectStem(noun)) && !synonyms.some(contains) && !setting) return `scene does not contain ${noun}`;
  const description = [pick.scene, pick.action, pick.motion, pick.endScene].filter(Boolean).join(" ");
  const dark = description.match(/\b(rope|cord|strap|noose|lasso|cable|chain)s?\b/i);
  if (dark) return `dark-read word: ${dark[0]}`;
  // A weapon line ("bring a knife, kill the snake") stays on the speaker: no cutaway of the weapon at all.
  const weapon = `${shows.join(" ")} ${description}`.match(/\b(knife|knives|gun|guns|pistol|rifle|sword|swords|machete|blade|blades|axe|dagger|two[ -]by[ -]four|2x4)\b/i);
  if (weapon) return `weapon stays on the speaker: ${weapon[0]}`;
  return null;
}

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

/** Moving-only reels also omit the still held under a cold-open hook. */
export function planBrollOpen(shots, duration, { enabled = false, duration: hold = 0.6 } = {}, { animate = false } = {}) {
  if (!enabled || animate || !shots.length) return null;
  return { duration: r3(Math.min(hold || 0.6, Math.max(0.3, duration / 20))), src: shots[0].src, file: shots[0].file };
}

const WORD_REF_SCHEMA = {
  type: "object", properties: { line: { type: "integer" }, wordIndex: { type: "integer" }, text: { type: "string" } },
  required: ["line", "wordIndex", "text"], additionalProperties: false,
};
/** A null reads like a field Codex left out (codexExec strips them too; injected test replies may not). */
export const withoutNulls = (picks) => picks.map((p) => Object.fromEntries(Object.entries(p).filter(([, v]) => v !== null)));

export const normaliseStockPicks = (picks) => withoutNulls(picks).map((p) => ({ stockSynonyms: [], ...p }));

export const PICKS_SCHEMA = {
  type: "object",
  properties: {
    picks: {
      type: "array",
      items: {
        type: "object",
        properties: {
          stockSynonyms: { type: "array", items: { type: "string" }, minItems: 0, maxItems: 3 }, stockQuery: { type: "string" }, line: { type: "integer" }, scene: { type: "string" }, shows: { type: "string" }, file: { type: "string" },
          duration: { type: "number" }, kind: { type: "string", enum: ["action", "ambient"] },
          action: { type: "string" }, motion: { type: "string" }, endScene: { type: "string" },
          sound: { type: "string" }, soundRole: { type: "string", enum: ["impact", "movement", "none"] },
          sequenceGroup: { type: "string" }, endsAt: WORD_REF_SCHEMA, endsBefore: WORD_REF_SCHEMA, need: { type: "string" },
        },
        // Optional fields stay optional here; codexExec's strictSchema makes them nullable for OpenAI.
        required: ["stockSynonyms", "stockQuery", "need", "line", "scene", "shows", "file", "duration", "kind", "action", "motion", "endsAt", "endsBefore"],
        additionalProperties: false,
      },
    },
  },
  required: ["picks"],
  additionalProperties: false,
};

/** Drawing instructions use the daylight opening-frame rules, without the older documentary finish. */
export function codexStillInstructions({ aspect = "9:16", style = "", file, assignedFiles = false } = {}) {
  return [
    `Use your image generation tool to draw each opening scene as a vertical ${aspect} (1080x1920) image. ${file ? `Save only ${file} in the current folder.` : assignedFiles ? "Save each image in the current folder using exactly the file name assigned in the picks below." : "Save broll-1.png, broll-2.png and so on in the current folder, in rank order."}`,
    `Look for every image: ${STILL_STYLE}${style ? ` ${style}` : ""}`,
    "Draw the named subject big, with the complete action area above captions. No faces, lettering, numbers or logos. Never draw a weapon, hanging rope, neck contact or harm.",
    // Codex saves a generated image by copying it out of ~/.codex/generated_images, so it must be allowed that one command.
    "Only run the copy command that saves each generated image under its file name; write no other files. Return the saved file name with each pick. An image tool failure drops that candidate.",
  ].join("\n");
}

export function picksPrompt(options) {
  const file = options.sourcesFirst ? "" : "broll-1.png";
  const instructions = options.sourcesFirst ? "Plan only. Do not draw images or use tools. Set file to an empty string; a still is drawn later only if footage is unavailable." : codexStillInstructions(options);
  return runwayPicksPrompt({ ...options, instructions: `${instructions}\nstockQuery: 2-4 plain search words that keep the spoken MEANING, subject plus its action or setting, such as skin cream applying (never bare cream), coconut falling, dog walking into house, desert highway driving or snake on branch. Never use a bare place or person name as shows. For Arizona or Albuquerque, anchor shows to exact spoken setting words such as driving or mountains and describe the implied real setting in scene and stockQuery (desert highway driving). For an ambient setting pick, action describes sustained visible setting movement, without a discrete event.\nstockSynonyms: 0 to 3 plain single words or short nouns naming the SAME subject in the SAME sense, for example gorilla -> ape, silverback. Never a broader category (dog -> pet, canine) or another sense (skin cream -> dessert). Use [] when none apply.`, reply: PICKS_REPLY.replace('"line":N,"shows"', `"file":${JSON.stringify(file)},"stockQuery":"snake on branch","stockSynonyms":["serpent"],"need":"a snake sliding along a branch","line":N,"shows"`) });
}

/** One planning retry fills missing moments; repeated lines cannot pretend to fill the request. */
export async function codexPicks(request, { dir, exec = codexExec, retryMissing = true, onDiscard } = {}) {
  const options = { cwd: dir, schema: PICKS_SCHEMA, timeoutMs: 600000 };
  const picks = normaliseStockPicks(JSON.parse(await exec(picksPrompt(request), options)).picks || []);
  const used = new Set(picks.map((p) => p.line));
  const remaining = request.candidates.filter((c) => !used.has(c.i));
  const missing = Math.min(request.count - used.size, remaining.length);
  if (retryMissing && missing > 0) {
    try {
      const reply = await exec(`${picksPrompt({ ...request, candidates: remaining, count: missing })}
The previous reply supplied only ${used.size} distinct moments for a request of ${request.count}.
Keep those picks. Return ${missing} additional filmable moments from the remaining lines, including a real moving setting when established by the story. Do not repeat these lines: ${[...used].join(", ")}.
Return fewer only if no other literal moving subject or real setting fits the remaining words.`, options);
      for (const p of normaliseStockPicks(JSON.parse(reply).picks || [])) {
        if (remaining.some((c) => c.i === p.line) && !used.has(p.line)) { picks.push(p); used.add(p.line); }
        else onDiscard?.(p, used.has(p.line) ? "the retry repeated an already picked line" : "the retry used a line not offered for additional moments");
      }
    } catch (e) { warn(`b-roll: missing-picks retry failed: ${String(e.message).split("\n")[0]}; keeping the first picks`); }
  }
  return picks;
}

const timedWords = (groups) => groups.flatMap((g, line) => (g.words || []).map((w, wordIndex) => ({ ...w, line, wordIndex })));
const refFor = (w) => w && ({ line: w.line, wordIndex: w.wordIndex, text: w.text });
const wordsForShot = (shot, groups) => timedWords(groups).filter((w) => w.start >= shot.start - 0.05 && w.start < shot.start + shot.duration);

/** Match the same spoken occurrence across caption regrouping, allowing at most two seconds of edit drift. */
export function approvedShotMatch(shot, oldGroups, groups) {
  const old = shot.spokenWords?.length ? shot.spokenWords : wordsForShot(shot, oldGroups);
  if (!old.length) return null;
  const words = timedWords(groups);
  const matches = words.map((w, i) => ({ w, i })).filter(({ w, i }) => Math.abs(w.start - old[0].start) <= 2 && old.every((o, k) => words[i + k] && norm(o.text) === norm(words[i + k].text)));
  matches.sort((a, b) => Math.abs(a.w.start - old[0].start) - Math.abs(b.w.start - old[0].start));
  const match = matches[0];
  if (!match) return null;
  const remap = (ref) => {
    const before = oldGroups[ref?.line]?.words?.[ref?.wordIndex];
    if (!before) return null;
    return words.filter((w) => norm(w.text) === norm(before.text) && Math.abs(w.start - before.start) <= 2).sort((a, b) => Math.abs(a.start - before.start) - Math.abs(b.start - before.start))[0];
  };
  const end = shot.pick?.endsAt ? remap(shot.pick.endsAt) : words[match.i + old.length - 1];
  const next = shot.pick?.endsBefore ? remap(shot.pick.endsBefore) : words[match.i + old.length];
  if (!end || !next) return null;
  return { ...shot.pick, line: match.w.line, shows: shot.shows, scene: shot.scene, kind: shot.kind || "action", action: shot.action || shot.pick?.action || "", stockQuery: shot.stockQuery || shot.pick?.stockQuery || "", duration: shot.duration, endsAt: refFor(end), endsBefore: refFor(next) };
}

/** Keep the failure note useful even when a watcher reads it after the editor exits. */
export function writeNoBrollNote(workDir, shots, picks, reason = "No literal moving footage passed inspection.") {
  const file = path.join(workDir, "No b-roll this time.txt");
  if (shots.length) { fs.rmSync(file, { force: true }); return; }
  const lines = picks.map((p) => `“${p.words || p.shows}”: ${[p.reason, ...(p.steps || []).filter((s) => /reject|failed|none|still clip|no room/i.test(s))].filter(Boolean).join("; ")}`);
  fs.writeFileSync(file, `No b-roll this time: ${reason} The speaker stays on screen.\n${lines.join("\n")}\n`);
}

/** Codex supplies first frames; the shared engine owns checks, spending, animation, recovery and sound. */
async function makeAnimatedBroll(args) {
  const { settings = {}, deps = {} } = args;
  if (!(deps.hasRunway || hasRunway)()) { warn("Codex moving b-roll needs RUNWAY_API_KEY; rendering without b-roll"); return []; }
  const exec = deps.codexExec || codexExec;
  const ready = () => {
    if (!(deps.hasCodex || hasCodex)()) throw new Error("Codex CLI is not signed in");
    if ((deps.codexPausedUntil || codexPausedUntil)()) throw new Error("Codex is paused after a rate limit");
  };
  return makeRunwayBroll({ ...args, stillSource: "codex", settings: { ...settings, codexPromptVersion: PROMPT_VERSION }, deps: {
    ...deps,
    planPicks: async (request, dir) => {
      ready();
      for (const file of fs.readdirSync(dir)) if (/^broll-\d+\.(png|jpe?g|webp)$/i.test(file)) fs.rmSync(path.join(dir, file), { force: true });
      return normaliseStockPicks(JSON.parse(await exec(picksPrompt({ ...request, aspect: settings.aspect || "9:16" }), { cwd: dir, schema: PICKS_SCHEMA, timeoutMs: 600000 })).picks || []);
    },
    drawStill: async ({ file, prompt, pick, reason, attempt, kind }) => {
      const dir = path.dirname(file);
      let source = savedImage(dir, path.basename(String(pick.file || "")));
      if (attempt || kind === "endImage") {
        ready();
        const name = path.basename(file);
        const fields = Object.fromEntries(Object.entries(pick).filter(([key]) => Object.hasOwn(PICKS_SCHEMA.properties.picks.items.properties, key)));
        const reply = JSON.parse(await exec([
          codexStillInstructions({ aspect: settings.aspect || "9:16", style: settings.style, file: name }),
          `Redraw only this opening frame: ${prompt}`,
          `Required subject: ${pick.shows}. Required event: ${pick.action}.`,
          `The previous still failed inspection: ${reason || "end frame required"}. Correct that defect and preserve the named subject.`,
          `Save the new image as ${name}. Reply with the same pick fields and this new file name.`,
          JSON.stringify({ picks: [{ ...fields, file: name }] }),
        ].join("\n"), { cwd: dir, schema: PICKS_SCHEMA, timeoutMs: 600000 }));
        source = savedImage(dir, path.basename(String(reply.picks?.[0]?.file || "")));
        if (source !== file) throw Object.assign(new Error("Codex redraw did not save the requested image"), { code: "DRAW" });
      }
      if (!source) throw Object.assign(new Error("Codex opening image missing"), { code: "DRAW" });
      if (source !== file) fs.copyFileSync(source, file);
      return { png: file, jpg: await conformStill(file, { runFn: deps.runFn }), items: [] };
    },
  } });
}

/** Free footage comes before a Codex still. Paid animation uses the shared Runway engine only when requested. */
export async function makeBroll({ workDir, groups, duration, hook, cta, settings = {}, force = false, busy = [], tail = 1, footage, caption = {}, deps = {} }) {
  if (settings.animate === true) return makeAnimatedBroll({ workDir, groups, duration, hook, cta, settings, force, busy, tail, footage, caption, deps });
  const sourcesFirst = settings.library === true || settings.stock?.length > 0;
  const dir = ensureDir(path.join(workDir, "broll"));
  const planPath = path.join(dir, "broll.json");
  const len = Math.max(1.2, Math.min(2.5, settings.duration ?? 2.4));
  const gap = settings.gap ?? 6;
  // With graphic cards in the reel, photos are an accent: fewer of them, in the gaps.
  const max = brollCount(duration, { max: busy.length ? settings.maxWithGraphics ?? 2 : settings.max ?? 3, every: settings.every ?? 12 });
  if (!max) { log("b-roll: reel too short, skipped"); return []; }
  const candidates = brollCandidates(groups, duration, { hook, cta, len: settings.rapidLists === false ? 1.2 : 0.8, busy, tail, clearStart: settings.clearStart ?? 0 });
  if (!candidates.length) { log("b-roll: no room after the hook, skipped"); return []; }
  const timing = (p, c, onReject) => runwayTiming(p, c, groups, { len, until: Math.min(duration - tail, cta?.start ?? Infinity), busy, onReject });
  const key = `${PROMPT_VERSION}|${JSON.stringify({ candidates, groups, settings, hook, cta, duration, busy, tail })}`;

  let saved;
  try { saved = readJSON(planPath); } catch {}
  if (!force && saved) {
    const stillThere = (s) => candidates.some((c) => Math.abs(c.start - s.start) < 0.05 && c.text === s.text);
    if (saved.promptVersion === PROMPT_VERSION && (!sourcesFirst || saved.shots?.length >= max) && (saved.key === key || !sourcesFirst && saved.shots?.every(stillThere)) && saved.shots?.length && saved.shots.every((s) => s.file && (!/\.mp4$/i.test(s.file) || sourcesFirst && s.moves?.ok && s.moves.look === "pass") && fs.existsSync(s.file))) {
      log(`b-roll: reusing ${saved.shots.length} shots from ${dir}`);
      writeBrollCredits(workDir, saved.shots);
      writeNoBrollNote(workDir, saved.shots, saved.picks || []);
      return saved.shots;
    }
  }
  const shots = [], records = [], fallbacks = [], t0 = Date.now();
  const finish = (reason) => {
    shots.sort((a, b) => a.start - b.start);
    writeJSON(planPath, { key, promptVersion: PROMPT_VERSION, stillSource: "codex", groups, picks: records, shots });
    writeBrollCredits(workDir, shots);
    writeNoBrollNote(workDir, shots, records, reason);
    if (shots.length) rememberScenes(shots.map((s) => s.scene), recentFile(deps.env));
    log(`b-roll: ${shots.length} shots ready in ${Math.round((Date.now() - t0) / 1000)}s${shots.map((s) => `\n  ${s.start}s "${s.text}": ${s.scene}`).join("")}`);
    return shots;
  };
  const recordPick = (p, rank, outcome = "pending") => {
    const c = candidates.find((c) => c.i === p.line), t = c && timing(p, c);
    const record = { line: p.line, rank, words: t ? spokenInShot({ start: t.start }, groups, { len: Math.max(0, t.duration - 0.5) }) : c?.text || p.shows || "", shows: p.shows, scene: p.scene, action: p.action || "", kind: p.kind || "action", stockQuery: p.stockQuery || "", synonyms: p.stockSynonyms || [], queries: [], outcome, reason: "", steps: [] };
    records.push(record);
    return record;
  };
  const recordFor = (p) => records.find((r) => r.rank === p.rank && r.outcome !== "reused");
  const pickDeps = (p) => ({ ...deps, onBrollStep: (pick, message) => { recordFor(p)?.steps.push(message); deps.onBrollStep?.(pick, message); }, onStockQuery: (query) => { recordFor(p)?.queries.push(query); deps.onStockQuery?.(query); } });

  // Approved footage belongs to this reel even if a written hook regrouped all the caption lines.
  let oldGroups = saved?.groups;
  if (!oldGroups && saved?.key) { try { oldGroups = JSON.parse(saved.key.slice(saved.key.indexOf("|") + 1)).groups; } catch {} }
  if (sourcesFirst) for (const approved of saved?.shots || []) {
    if (shots.length >= max) break;
    if (!approved.moves?.ok || approved.moves.look !== "pass" || !/\.mp4$/i.test(approved.file || "") || !fs.existsSync(approved.file)) continue;
    const pick = approvedShotMatch(approved, oldGroups || [], groups);
    const c = pick && candidates.find((c) => c.i === pick.line), t = c && timing(pick, c);
    if (!t || checkPick(pick, { ...c, start: t.start }, groups, { len: t.duration, stock: true }) || shots.some((s) => t.start < s.start + s.duration + gap && t.start + t.duration + gap > s.start)) continue;
    const record = recordPick(pick, -records.length - 1, "reused");
    let reused = { ...approved, line: pick.line, start: r3(t.start), duration: r3(t.duration), text: c.text };
    if (Math.abs(t.duration - approved.duration) > 0.001) {
      const source = approved.full && fs.existsSync(approved.full) ? approved.full : approved.file;
      const file = path.join(fs.mkdtempSync(path.join(dir, "reuse-")), "clip.mp4");
      fs.copyFileSync(source, file);
      try {
        const checked = await (deps.reviewMovingClip || reviewMovingClip)({ file, duration: source === approved.full ? approved.sourceDuration : approved.duration, pick, shot: reused, groups, dir: path.dirname(file), deps });
        if (!checked) throw new Error("the new cut did not pass inspection");
        reused = { ...reused, ...checked };
      } catch (e) { record.outcome = "rejected"; record.reason = `Previously approved footage could not fit the new words: ${String(e.message).split("\n")[0]}`; continue; }
    }
    shots.push({ ...reused, pick, spokenWords: wordsForShot(reused, groups) });
    record.reason = "Kept the approved moving clip for the same spoken words and time.";
    brollStep(pick, `reused approved ${approved.source || "moving"} clip at ${reused.start}s for ${reused.duration}s`, deps);
  }
  const remaining = candidates.filter((c) => !shots.some((s) => c.start < s.start + s.duration + gap && c.start + len + gap > s.start));
  if (shots.length >= max || !remaining.length) return finish();
  const has = deps.hasCodex || hasCodex, paused = deps.codexPausedUntil || codexPausedUntil, exec = deps.codexExec || codexExec;
  if (!has()) { warn("b-roll needs the Codex CLI (codex) signed in; skipped"); return finish("Codex is not signed in to pick more footage."); }
  const until = paused();
  if (until) { warn(`b-roll: Codex is paused after a rate limit until ${new Date(until).toLocaleTimeString()}; rendering without it`); return finish("Codex is paused after a rate limit."); }

  for (const f of fs.readdirSync(dir)) if (/^broll-\d+\.(png|jpe?g|webp)$/i.test(f)) fs.rmSync(path.join(dir, f), { force: true });
  let picks;
  const discarded = [];
  try {
    const count = max - shots.length;
    log(`b-roll: Codex is picking ${count} moment${count === 1 ? "" : "s"}${sourcesFirst ? " for library and stock" : " and drawing the stills"}…`);
    const transcript = groups.map((g) => g.text).join(" ");
    picks = await codexPicks({ candidates: remaining, transcript, hook: hook?.text, count, spacing: gap, duration: len, style: settings.style || "", recent: readRecent(recentFile(deps.env)), sourcesFirst, aspect: settings.aspect || "9:16", world: settings.worldInPrompt ? settings.world || "" : "" }, { dir, exec, retryMissing: sourcesFirst, onDiscard: (pick, reason) => discarded.push({ pick, reason }) });
  } catch (e) {
    warn(`b-roll: ${String(e.message).split("\n")[0]}; rendering without it`);
    return finish("Footage planning failed; see the reel log.");
  }
  picks.forEach((p, i) => recordPick(p, i + 1));
  const reject = (p, why) => { const r = recordFor(p); if (r) { r.outcome = "rejected"; r.reason = why; } brollStep(p, `dropped: ${why}`, pickDeps(p)); };
  for (const [i, { pick, reason }] of discarded.entries()) {
    const rank = picks.length + i + 1;
    recordPick(pick, rank);
    reject({ ...pick, rank }, reason);
  }
  const valid = validateBrollPicks(picks, remaining, groups, timing, settings, { onReject: reject, stock: sourcesFirst });
  const imageFor = (p) => p.file ? savedImage(dir, path.basename(String(p.file))) : null;
  const planned = sourcesFirst ? valid : valid.filter(imageFor);
  for (const p of valid) if (!planned.includes(p)) reject(p, "Codex saved no opening image");
  const search = deps.stockSearch || createStockSearch({ env: deps.env, fetchFn: deps.fetchFn, now: deps.now, maxSearches: settings.stockMaxSearches ?? 20, stockCandidates: settings.stockCandidates ?? 12 });
  const placed = placePlannedBroll(planned, remaining, { gap, max: max - shots.length, timing });
  for (const p of planned) if (!placed.some((s) => s.rank === p.rank)) reject(p, `no room within ${gap}s spacing and ${max}-shot limit before the next subject`);
  const placeStill = ({ pick, shot, k }, file) => {
    shots.push({ ...shot, pick, spokenWords: wordsForShot(shot, groups), ...(pick.stockQuery ? { stockQuery: pick.stockQuery } : {}), motion: ["in", "left", "out", "right"][k % 4], file, stillSource: "codex" });
    recordFor(pick).outcome = "placed"; recordFor(pick).reason = "Placed the requested still.";
    brollStep(pick, `placed Codex still at ${shot.start}s for ${shot.duration}s`, pickDeps(pick));
  };
  for (const [k, shot] of placed.entries()) {
    const pick = valid.find((p) => p.rank === shot.rank);
    const routeDeps = pickDeps(pick);
    let moving;
    if (settings.library) {
      moving = await findLibraryClip({ pick, shot, groups, workDir, dir, deps: routeDeps });
      brollStep(pick, moving ? `library hit ${moving.libraryId}` : "library miss: no eligible clip passed inspection", routeDeps);
    }
    if (!moving && settings.stock?.length) moving = await makeStockClip({ pick, shot, groups, workDir, dir, settings, search, deps: routeDeps });
    if (moving) {
      recordFor(pick).outcome = "placed"; recordFor(pick).reason = "Placed real moving footage after inspection.";
      shots.push({ ...moving, pick, spokenWords: wordsForShot(moving, groups), ...(pick.stockQuery ? { stockQuery: pick.stockQuery } : {}) });
      brollStep(pick, `placed ${moving.source} clip at ${moving.start}s for ${moving.duration}s`, routeDeps);
      continue;
    }
    // Greg's rule: real moving B-roll or none. With footage sources on, a miss keeps the speaker on screen unless
    // the preset opts back into drawn stills (broll.stillFallback).
    if (sourcesFirst && settings.stillFallback !== true) { recordFor(pick).outcome = "no-clip"; recordFor(pick).reason = "No real moving clip passed the searches and inspection."; brollStep(pick, "kept the speaker on screen: no real moving clip passed", routeDeps); continue; }
    const stillWhy = checkPick(pick, shot, groups, { len: shot.duration });
    if (stillWhy) { reject(pick, `generated still: ${stillWhy}`); continue; }
    const file = imageFor(pick);
    if (file) { brollStep(pick, "still drawn: opening image saved", deps); placeStill({ pick, shot, k }, file); }
    else fallbacks.push({ pick, shot, k, name: `broll-${k + 1}.png` });
  }
  // One image session for every footage miss; a failed image must not stop the other picks.
  if (fallbacks.length) {
    for (const { pick } of fallbacks) brollStep(pick, "still requested: footage unavailable", deps);
    let failure;
    try {
      await exec([codexStillInstructions({ aspect: settings.aspect || "9:16", style: settings.style, assignedFiles: true }),
        "Draw every approved scene below, one image per pick, using exactly its assigned file name. Keep the given order and file names, even when a pick fails. If one image fails, continue with the remaining picks. Do not reconsider the picks or search for footage.",
        ...fallbacks.map(({ pick, name }) => `Draw this approved scene only: ${pick.scene}. Required subject: ${pick.shows}. Harmless event: ${pick.action}. Save as ${name}.`),
        `Reply with these same picks and their saved file names: ${JSON.stringify({ picks: fallbacks.map(({ pick, name }) => ({ ...pick, file: name })) })}`,
      ].join("\n"), { cwd: dir, schema: PICKS_SCHEMA, timeoutMs: 600000 });
    } catch (e) { failure = String(e.message).split("\n")[0]; }
    for (const item of fallbacks) {
      const file = savedImage(dir, item.name);
      if (file) { brollStep(item.pick, `still drawn: ${item.name}`, deps); placeStill(item, file); }
      else {
        brollStep(item.pick, `still failed: ${failure || `Codex did not save a usable ${item.name}`}`, deps);
        brollStep(item.pick, "dropped: no usable image after footage miss", pickDeps(item.pick));
        recordFor(item.pick).outcome = "no-clip"; recordFor(item.pick).reason = "No usable image after footage miss.";
      }
    }
  }
  return finish(picks.length ? undefined : "No literal filmable moments were returned after planning.");
}
