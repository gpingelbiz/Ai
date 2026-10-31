import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { claudeText, claudeLook, firstJSON, hasClaude } from "./claude.mjs";
import { brollCount, brollCandidates, placeBroll, readRecent, rememberScenes } from "./broll.mjs";
import { probe } from "./probe.mjs";
import { detectFaces } from "./placement.mjs";
import { SDR_FILTER, SDR_TAGS } from "./hdr.mjs";
import { run, log, warn, readJSON, writeJSON, ensureDir, r3, VIDEO_EXTS } from "./util.mjs";

/**
 * B-roll from the speaker's OWN footage: a folder of their real clips (lifestyle, events, behind the scenes) instead
 * of AI stills (Codex) or AI video (Runway). The top reels in the 2026-10-29 b-roll study and every one of Julee's
 * reference accounts cut to the creator's own footage, full screen, about 2 seconds, while the voice keeps going.
 *
 * Each clip is indexed once (length, shape, the face in it every half second, and a few lines Claude writes from its
 * frames), cached next to it as "<clip>.json". Per reel Claude reads the caption lines and the index and picks the
 * line, the clip and the second; the editor cuts that moment muted, cropped to 9:16 around the face.
 * A clip is used at most once in a reel, and recent picks are remembered so the next reel reaches for others.
 */

export const INDEX_VERSION = 1;
export const indexPath = (clip) => `${clip}.json`;

/** Video files in a library folder, by name (hidden files and the index files skipped). */
export function libraryClips(dir) {
  try {
    return fs.readdirSync(dir)
      .filter((f) => !f.startsWith(".") && VIDEO_EXTS.has(path.extname(f).toLowerCase()))
      .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }))
      .map((f) => path.join(dir, f));
  } catch { return []; }
}

export const orientationOf = (w, h) => (w / h < 0.9 ? "portrait" : w / h > 1.1 ? "landscape" : "square");

/** When Claude looks at a clip: one frame about every 5 seconds, 3 to 10 of them, from the middle of each stretch. */
export function frameTimes(duration, { every = 5, min = 3, max = 10 } = {}) {
  const n = Math.max(min, Math.min(max, Math.ceil(duration / every)));
  return Array.from({ length: n }, (_, k) => Math.round(((k + 0.5) * duration) / n * 10) / 10);
}

/** Where the face is every `step` seconds (the crop centre at cut time), so Vision runs once per clip, not per reel. */
export function faceSampleTimes(duration, step = 0.5) {
  const out = [];
  for (let t = step / 2; t < duration; t += step) out.push(r3(t));
  return out;
}

/** The largest face per frame (an upper body when nobody faces the camera) as its centre, frames with nobody left out. */
export function faceTrack(detection) {
  const out = [];
  for (const f of detection?.frames || []) {
    const boxes = (f.faces && f.faces.length ? f.faces : f.bodies) || [];
    if (!boxes.length) continue;
    const b = boxes.reduce((a, c) => (c.w * c.h > a.w * a.h ? c : a));
    out.push({ t: f.t, x: r3(b.x + b.w / 2), y: r3(b.y + b.h / 2) });
  }
  return out;
}

export function indexPrompt({ name, duration, orientation, frames, world = "" }) {
  return [
    "You are cataloguing one clip from a creator's own b-roll library, so an editor can later cut to the right second of it under a line of a talking-head reel.",
    `Use the Read tool to look at each of these frames from the clip (they are in the current folder), then reply with JSON only:`,
    ...frames.map((f) => `- ${f.file}: ${f.t.toFixed(1)} s`),
    "",
    `The clip: "${name}" (the file name may say what it is), ${duration.toFixed(1)} s long, ${orientation}.`,
    world ? `Whose library it is: ${world.trim().slice(0, 600)}` : "",
    "Call the person who appears most \"the creator\"; never guess anyone's name.",
    "Write:",
    "- `description`: one sentence, under 30 words, on what the clip shows overall: who, where, what happens, the light. Concrete, no adjectives that sell.",
    "- `moments`: one per frame, its time and under 15 words on what is on screen at that second (subject, action, close or wide). Say it when a frame is blurry, dark, shaky or mid-turn, so that second is not used.",
    'Reply: {"description":"...","moments":[{"t":<seconds>,"what":"..."}]}',
  ].filter(Boolean).join("\n");
}

/** The description and moments from Claude's reply, the moments kept to real times inside the clip. */
export function parseIndexReply(reply, duration) {
  const j = firstJSON(reply);
  const description = String(j.description || "").replace(/\s+/g, " ").trim();
  const moments = (Array.isArray(j.moments) ? j.moments : [])
    .map((m) => ({ t: Math.round(Number(m.t) * 10) / 10, what: String(m.what || "").replace(/\s+/g, " ").trim() }))
    .filter((m) => Number.isFinite(m.t) && m.t >= 0 && m.t <= duration && m.what)
    .sort((a, b) => a.t - b.t);
  if (!description) throw new Error("no description in the reply");
  return { description, moments };
}

/** A name to fall back on when Claude cannot look: the file name, which people tend to write as a description. */
const nameOf = (file) => path.basename(file, path.extname(file)).replace(/[_-]+/g, " ").replace(/\s+/g, " ").trim();

async function extractFrames(file, frames, dir, meta) {
  for (const f of frames) {
    const vf = [meta.hdr ? SDR_FILTER : null, "scale=640:640:force_original_aspect_ratio=decrease:force_divisible_by=2"].filter(Boolean).join(",");
    await run("ffmpeg", ["-y", "-loglevel", "error", "-ss", String(f.t), "-i", file, "-frames:v", "1", "-vf", vf, "-q:v", "4", path.join(dir, f.file)], { capture: true });
  }
}

/**
 * Index one clip: reuse "<clip>.json" while the clip's size and modified time match (a description fixed by hand
 * stays), otherwise probe it, find the face every half second and have Claude describe a few frames. Without Claude
 * the file name stands in as the description. Never throws for a description; throws only when the clip will not probe.
 */
export async function indexClip(file, { world = "", force = false, deps = {} } = {}) {
  const st = fs.statSync(file);
  const sidecar = indexPath(file);
  if (!force && fs.existsSync(sidecar)) {
    try {
      const saved = readJSON(sidecar);
      if (saved.version === INDEX_VERSION && saved.size === st.size && Math.round(saved.mtimeMs) === Math.round(st.mtimeMs)) return { ...saved, path: file, cached: true };
    } catch {}
  }
  const meta = await (deps.probe || probe)(file);
  const duration = r3(meta.duration);
  const entry = {
    version: INDEX_VERSION, file: path.basename(file), size: st.size, mtimeMs: Math.round(st.mtimeMs),
    duration, width: meta.width, height: meta.height, orientation: orientationOf(meta.width, meta.height), fps: meta.fps,
    hdr: meta.hdrKind || null, description: nameOf(file), described: false, moments: [], faces: [],
  };
  entry.faces = faceTrack(await (deps.detectFaces || detectFaces)(file, faceSampleTimes(duration)));
  if ((deps.hasClaude || hasClaude)()) {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "reel-broll-index-"));
    try {
      const frames = frameTimes(duration).map((t, k) => ({ t, file: `frame-${k + 1}.jpg` }));
      await (deps.extractFrames || extractFrames)(file, frames, tmp, meta);
      const reply = await (deps.claudeLook || claudeLook)(indexPrompt({ name: path.basename(file), duration, orientation: entry.orientation, frames, world }), { cwd: tmp });
      Object.assign(entry, parseIndexReply(reply, duration), { described: true });
    } catch (e) {
      warn(`b-roll library: could not describe ${path.basename(file)} (${String(e.message).split("\n")[0]}); using its file name`);
    } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
  }
  entry.indexedAt = new Date().toISOString();
  // A read-only folder (a shared drive) still gets its b-roll; it is only looked at again next time.
  try { writeJSON(sidecar, entry); } catch (e) { warn(`b-roll library: could not save ${path.basename(sidecar)} (${e.code || e.message})`); }
  return { ...entry, path: file, cached: false };
}

/** Index every clip in a library folder (new or changed ones only), a few at a time. Clips that will not probe are skipped. */
export async function indexLibrary(dir, { world = "", force = false, concurrency = 3, deps = {} } = {}) {
  const files = libraryClips(dir);
  const out = new Array(files.length).fill(null);
  let next = 0, fresh = 0;
  const worker = async () => {
    while (next < files.length) {
      const k = next++;
      try {
        out[k] = await indexClip(files[k], { world, force, deps });
        if (!out[k].cached) fresh++;
      } catch (e) { warn(`b-roll library: skipped ${path.basename(files[k])} (${String(e.message).split("\n")[0]})`); }
    }
  };
  await Promise.all(Array.from({ length: Math.max(1, Math.min(concurrency, files.length)) }, worker));
  if (fresh) log(`b-roll library: indexed ${fresh} new clip${fresh === 1 ? "" : "s"} in ${dir}`);
  return out.filter(Boolean);
}

/** Picks this client's recent reels used (REEL_CACHE keeps a client's history apart from Greg's). */
export const libraryRecentFile = (env = process.env) => env.REEL_BROLL_LIBRARY_RECENT || path.join(env.REEL_CACHE || path.join(os.homedir(), ".cache", "reel-editor"), "broll-library-recent.json");

/** A clip's usable seconds for a cut of `len`: half a second clear of each end, where phone clips shake. */
export function usableRange(duration, len) {
  const edge = duration >= len + 1.2 ? 0.5 : Math.max(0, (duration - len) / 2 - 0.05);
  const from = r3(edge), to = r3(duration - len - edge);
  return to >= from ? { from, to } : null;
}

export function libraryPrompt({ candidates, transcript, hook, count, spacing = 6, len = 2, clips, recent = [], world = "" }) {
  const fmt = (c) => {
    const range = usableRange(c.duration, len);
    const moments = (c.moments || []).map((m) => `${m.t.toFixed(1)}s ${m.what}`).join("; ");
    return `${c.id}: "${c.file}" ${c.duration.toFixed(1)} s, ${c.orientation}, usable from ${range.from}s to ${range.to}s. ${c.description}${moments ? `\n   Moments: ${moments}` : ""}`;
  };
  return [
    "You are a reel editor cutting b-roll into a talking-head Instagram reel from the speaker's OWN footage: real clips of their life and work, not stock, not AI. Each cutaway is full screen for about " + `${len} seconds while the voice and captions keep going. Reply with JSON only; use no tools.`,
    `Pick up to ${count} caption line${count === 1 ? "" : "s"} where cutting to one of these clips makes the line land harder, spread across the reel, at least ${spacing} seconds apart. For each, pick the clip that best shows what the line is about and the second in that clip where the cut should start.`,
    "Rules:",
    "- Use each clip at most once in this reel.",
    "- Only pick a clip that truly fits the line (the place, the activity, the people, the feeling of that moment). Fewer cutaways beat one that does not fit.",
    "- Start the cut on a moment that is clear and steady, inside the clip's usable range; skip moments described as blurry, dark, shaky or mid-turn.",
    "- Skip lines where the speaker says something about themself that only their face can carry (a confession, the punchline, a direct ask).",
    world ? `The speaker's world: ${world.trim().slice(0, 600)}` : "",
    recent.length ? `Recent reels already used these clip moments; never the same moment again, and when another clip fits as well, use it:\n${recent.map((s) => `- ${s}`).join("\n")}` : "",
    "",
    "The library (id: file, length, shape, usable seconds, what it shows):",
    ...clips.map(fmt),
    "",
    `Hook on screen at the start: ${hook || "(none)"}`,
    "",
    "Whole transcript for context:",
    transcript,
    "",
    "Lines you may pick from (number: start time, text):",
    ...candidates.map((c) => `${c.i}: ${c.start.toFixed(1)}s ${c.text}`),
    "",
    'Reply: {"picks":[{"line":<number from the list>,"clip":<clip id>,"at":<seconds into the clip>,"why":"..."}]}',
  ].filter(Boolean).join("\n");
}

/** What the clip shows nearest to a second (its closest moment), for the plan and the cutaway notes. */
export function momentAt(clip, t) {
  const m = (clip.moments || []).reduce((best, x) => (!best || Math.abs(x.t - t) < Math.abs(best.t - t) ? x : best), null);
  return m ? m.what : clip.description;
}

/**
 * Claude's picks as timed shots: real lines and real clips only, each clip once, the start second kept inside the
 * clip's usable range, then the same spacing and count as every other engine (placeBroll).
 */
export function placeLibrary(picks, candidates, clips, { len = 2, gap = 4, max = 3 } = {}) {
  const lines = new Map(candidates.map((c) => [c.i, c]));
  const byId = new Map(clips.map((c) => [c.id, c]));
  const chosen = [];
  for (const p of [...(picks || [])].filter((p) => lines.has(p.line) && byId.has(Number(p.clip))).sort((a, b) => lines.get(a.line).start - lines.get(b.line).start)) {
    const clip = byId.get(Number(p.clip));
    const range = usableRange(clip.duration, len);
    if (!range || chosen.some((c) => c.clip.id === clip.id)) continue;
    const at = r3(Math.max(range.from, Math.min(range.to, Number(p.at) || range.from)));
    const next = { line: p.line, clip, at, scene: `${clip.file} at ${at}s: ${momentAt(clip, at)}` };
    // Only a pick that places (not too close to the one before, not past the count) uses its clip up.
    if (placeBroll([...chosen, next], candidates, { len, gap, max }).length > chosen.length) chosen.push(next);
  }
  return placeBroll(chosen, candidates, { len, gap, max }).map((s, k) => ({ ...s, motion: "none", clip: chosen[k].clip, at: chosen[k].at }));
}

/**
 * The 9:16 window (source pixels, even sizes) around a point (fractions of the upright frame): a wider clip is cut to
 * full height with the face centred across; a taller one to full width with the face a little above the middle.
 */
export function cropBox({ width, height }, at = { x: 0.5, y: 0.4 }, aspect = 9 / 16) {
  const even = (n) => Math.floor(n / 2) * 2;
  const size = (n) => Math.max(2, even(n));
  const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
  if (width / height > aspect) {
    const w = size(height * aspect), h = size(height);
    return { w, h, x: even(clamp(at.x * width - w / 2, 0, width - w)), y: 0 };
  }
  const w = size(width), h = size(width / aspect);
  return { w, h, x: 0, y: even(clamp(at.y * height - h * 0.4, 0, height - h)) };
}

/** The face nearest to a second in a clip's face track (within `within` s), or null. */
export function faceNear(track = [], t, within = 0.75) {
  const f = track.reduce((best, p) => (!best || Math.abs(p.t - t) < Math.abs(best.t - t) ? p : best), null);
  return f && Math.abs(f.t - t) <= within ? f : null;
}

/**
 * ffmpeg args for one cutaway: `len` seconds from `at`, no sound, HDR brought to BT.709 SDR, cropped to 9:16 around
 * the face and scaled to the canvas. When the face moves across the cut, the window eases from where it is at the
 * start to where it is at the end (the reframe idea, for two seconds); otherwise it holds still.
 */
export function cutArgs({ input, output, at, len, meta, track = [], canvas = { width: 1080, height: 1920 }, fps = 30 }) {
  const f0 = faceNear(track, at + 0.25), f1 = faceNear(track, at + len - 0.25);
  const centre = { x: 0.5, y: 0.4 };
  const a = cropBox(meta, f0 || f1 || centre, canvas.width / canvas.height);
  const b = cropBox(meta, f1 || f0 || centre, canvas.width / canvas.height);
  const moves = Math.abs(a.x - b.x) > meta.width * 0.03 || Math.abs(a.y - b.y) > meta.height * 0.03;
  const e = `min(1,t/${len})`, ease = `(${e}*${e}*(3-2*${e}))`;
  const crop = moves ? `crop=${a.w}:${a.h}:'${a.x}+(${b.x - a.x})*${ease}':'${a.y}+(${b.y - a.y})*${ease}'` : `crop=${a.w}:${a.h}:${a.x}:${a.y}`;
  // PQ would want the VideoToolbox tone-map (hdr.mjs); phones record HLG, which this filter handles.
  const vf = [meta.hdr ? SDR_FILTER : null, "setpts=PTS-STARTPTS", crop, `scale=${canvas.width}:${canvas.height}:flags=lanczos`, "setsar=1", `fps=${fps}`, "format=yuv420p"].filter(Boolean).join(",");
  return ["-y", "-loglevel", "error", "-ss", String(at), "-t", String(r3(len + 0.1)), "-i", input, "-an", "-vf", vf, "-c:v", "libx264", "-preset", "medium", "-crf", "17", "-pix_fmt", "yuv420p", ...SDR_TAGS, "-movflags", "+faststart", output];
}

export async function cutShot({ clip, at, len, out, still, canvas, fps }) {
  const meta = { width: clip.width, height: clip.height, hdr: !!clip.hdr };
  await run("ffmpeg", cutArgs({ input: clip.path, output: out, at, len, meta, track: clip.faces, canvas, fps }), { capture: true });
  await run("ffmpeg", ["-y", "-loglevel", "error", "-i", out, "-frames:v", "1", still], { capture: true });
}

/**
 * Plan and cut the library b-roll for one reel. Writes <workDir>/broll/broll.json and broll-<n>.mp4 (+ a still of
 * each for the cold open) and returns shots with an mp4 `file` and `motion: "none"`, like the Runway engine. Reuses
 * the saved cuts while the caption lines are unchanged. Never throws: any failure returns [] (no b-roll).
 */
export async function makeLibraryBroll({ workDir, groups, duration, hook, cta, settings = {}, force = false, busy = [], tail = 1, canvas = { width: 1080, height: 1920 }, fps = 30, deps = {} }) {
  const dir = ensureDir(path.join(workDir, "broll"));
  const planPath = path.join(dir, "broll.json");
  const len = Math.max(1.6, Math.min(3, settings.duration ?? 2));
  const gap = settings.gap ?? 4;
  const max = brollCount(duration, { max: busy.length ? settings.maxWithGraphics ?? 2 : settings.max ?? 3, every: settings.every ?? 12 });
  if (!max) { log("b-roll: reel too short, skipped"); return []; }
  const candidates = brollCandidates(groups, duration, { hook, cta, len, busy, tail, clearStart: settings.clearStart ?? 0 });
  if (!candidates.length) { log("b-roll: no room after the hook, skipped"); return []; }
  const key = candidates.map((c) => `${c.i}@${c.start}:${c.text}`).join("|");
  if (!force && fs.existsSync(planPath)) {
    const saved = readJSON(planPath);
    const stillThere = (s) => candidates.some((c) => Math.abs(c.start - s.start) < 0.05 && c.text === s.text);
    if (saved.engine === "library" && (saved.key === key || saved.shots?.every(stillThere)) && saved.shots?.length && saved.shots.every((s) => s.file && fs.existsSync(s.file))) {
      log(`b-roll: reusing ${saved.shots.length} library cut${saved.shots.length === 1 ? "" : "s"} from ${dir}`);
      return saved.shots;
    }
  }
  const library = settings.library;
  if (!library || !fs.existsSync(library)) { warn(`b-roll library: no folder at ${library || "(broll.library not set)"}; rendering without b-roll`); return []; }
  if (!(deps.hasClaude || hasClaude)()) { warn("b-roll library: needs the Claude Code CLI to pick the clips; rendering without b-roll"); return []; }
  const t0 = Date.now();
  const indexed = await (deps.indexLibrary || indexLibrary)(library, { world: settings.world || "", deps });
  const clips = indexed.filter((c) => usableRange(c.duration, len)).map((c, k) => ({ ...c, id: k + 1 }));
  if (!clips.length) { warn(`b-roll library: no clip in ${library} is at least ${len} s long; rendering without b-roll`); return []; }

  let picks;
  try {
    log(`b-roll: Claude is picking up to ${max} moment${max === 1 ? "" : "s"} from ${clips.length} library clip${clips.length === 1 ? "" : "s"}…`);
    const transcript = groups.map((g) => g.text).join(" ");
    const recent = readRecent(libraryRecentFile());
    const reply = await (deps.claudeText || claudeText)(libraryPrompt({ candidates, transcript, hook: hook?.text, count: max, spacing: len + gap, len, clips, recent, world: settings.world || "" }), { timeoutMs: 240000 });
    picks = firstJSON(reply).picks || [];
  } catch (e) {
    warn(`b-roll library: ${String(e.message).split("\n")[0]}; rendering without b-roll`);
    return [];
  }
  const placed = placeLibrary(picks, candidates, clips, { len, gap, max });
  if (!placed.length) { warn("b-roll library: no clip fit a line; rendering without b-roll"); return []; }
  for (const f of fs.readdirSync(dir)) if (/^broll-\d+\.(png|jpe?g|webp|mp4)$/i.test(f)) fs.rmSync(path.join(dir, f), { force: true });
  const cut = deps.cutShot || cutShot;
  const shots = [];
  for (const s of placed) {
    const k = shots.length + 1;
    const out = path.join(dir, `broll-${k}.mp4`), still = path.join(dir, `broll-${k}.png`);
    try {
      await cut({ clip: s.clip, at: s.at, len, out, still, canvas, fps });
      const { clip, ...rest } = s;
      // real: the reel's own footage, so the post is not labelled AI-made. clipSeconds: no longer than the cut, so a
      // "full-split" layout never holds it past its end.
      shots.push({ ...rest, file: out, still, real: true, clipSeconds: len, source: { clip: clip.path, name: clip.file, at: s.at } });
    } catch (e) { warn(`b-roll library: could not cut ${s.clip.file} at ${s.at}s (${String(e.message).split("\n")[0]})`); }
  }
  if (shots.length) { writeJSON(planPath, { engine: "library", key, shots }); rememberScenes(shots.map((s) => `${s.source.name} at ${s.at}s`), libraryRecentFile()); }
  log(`b-roll: ${shots.length} library cut${shots.length === 1 ? "" : "s"} ready in ${Math.round((Date.now() - t0) / 1000)}s${shots.map((s) => `\n  ${s.start}s "${s.text}": ${s.scene}`).join("")}`);
  return shots;
}
