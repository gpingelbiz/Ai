import fs from "node:fs";
import path from "node:path";
import { assetPath, assertNoGreg, LOGO_RELATIONSHIPS, headshotProblems } from "./speaker-intake.mjs";
import { probeSource } from "./speaker-index.mjs";
import { resolveBrandTokens } from "./brandtokens.mjs";
import { SDR_FILTER, SDR_TAGS, rotateFilters, toneMapToSdr } from "./hdr.mjs";
import { measureLoudness } from "./preflight.mjs";
import { groupWords } from "./captions.mjs";
import { sliceWords } from "./clips.mjs";
import { readJSON, writeJSON, ensureDir, run, warn } from "./util.mjs";

const ROLES = ["opening", "identity", "proof", "core", "room", "testimonial", "close", "booking", "montage"];
const CARD_TYPES = ["title", "booking", "testimonial-name", "quote", "logo-wall", "topic"];
const finite = (x) => typeof x === "number" && Number.isFinite(x);
const sourceRow = (index, id) => index?.sources?.[id] || index?.[id];
const seconds = (frame, fps) => frame / fps;

/** Used proof includes testimonial excerpts and all card references, not just full-screen cards. */
export function planUsage(plan, manifest) {
  const sourceIds = new Set([...plan.items.filter((i) => i.kind === "clip").map((i) => i.sourceId), ...(plan.cutaways || []).map((x) => x.sourceId)]);
  const proofIds = new Set();
  for (const entry of [...plan.items, ...(plan.overlays || [])]) {
    if (entry.proofId) proofIds.add(entry.proofId);
    if (entry.card?.proofId) proofIds.add(entry.card.proofId);
    for (const id of Array.isArray(entry.card?.logos) ? entry.card.logos : []) proofIds.add(id);
    if (entry.card?.type === "quote" && !entry.card.proofId) {
      for (const p of manifest.proof || []) if (p.kind === "quote" && p.text === entry.card.text) proofIds.add(p.id);
    }
    if (entry.card?.type === "testimonial-name" && !entry.card.proofId && entry.card.name) {
      for (const p of manifest.proof || []) if (p.kind === "testimonial-video" && ["name", "title", "org"].every((k) => entry.card[k] == null || entry.card[k] === (p.attribution?.[k] || ""))) proofIds.add(p.id);
    }
    if (entry.card?.type === "topic" && !Object.values(manifest.identity || {}).includes(entry.card.text)) {
      for (const p of manifest.proof || []) if (p.text === entry.card.text) proofIds.add(p.id);
    }
  }
  for (const p of manifest.proof || []) {
    if (p.sourceId && [...plan.items, ...(plan.cutaways || [])].some((i) => i.sourceId === p.sourceId && i.out > (p.in ?? 0) && i.in < (p.out ?? Infinity))) proofIds.add(p.id);
  }
  return { sourceIds: [...sourceIds], proofIds: [...proofIds] };
}

export function validatePlan(plan, { manifest, index, draft = false } = {}) {
  const problems = [];
  const add = (id, message, level = "error") => problems.push({ level, id, message });
  if (!plan || typeof plan !== "object") return [{ level: "error", id: "plan", message: "plan must be an object" }];
  if (!manifest || !index) return [{ level: "error", id: "plan", message: "manifest and source index are required" }];
  try { assertNoGreg(plan, "plan"); } catch (e) { add("plan", e.message); }
  if (plan.schemaVersion !== 1) add("plan", "schemaVersion must be 1");
  if (plan.clientId !== manifest?.clientId) add("plan", "clientId does not match the manifest");
  if (!/^[a-zA-Z0-9][a-zA-Z0-9_-]*$/.test(plan.version || "")) add("plan", "version must be a safe folder name");
  if (!Number.isInteger(plan.revision) || plan.revision < 1) add("plan", "revision must be a positive integer");
  const canvas = plan.canvas || {};
  if (canvas.width !== 1920 || canvas.height !== 1080 || canvas.fps !== 30) add("canvas", "speaker core requires 1920x1080 at 30 fps");
  if (!Array.isArray(plan.items) || !plan.items.length) add("plan", "items must be a non-empty array");
  for (const key of ["overlays", "cutaways"]) if (plan[key] != null && !Array.isArray(plan[key])) add(key, `${key} must be an array`);
  const items = Array.isArray(plan.items) ? plan.items.filter((x) => x && typeof x === "object") : [];
  if (Array.isArray(plan.items) && items.length !== plan.items.length) add("plan", "items must be objects");
  const overlays = Array.isArray(plan.overlays) ? plan.overlays : [], cutaways = Array.isArray(plan.cutaways) ? plan.cutaways : [];
  const allIds = new Set(), byId = new Map(items.map((i) => [i.id, i]));
  const sources = new Map((manifest?.sources || []).map((s) => [s.id, s]));
  const proofs = new Map((manifest?.proof || []).map((p) => [p.id, p]));
  const duration = (i) => i.kind === "clip" ? i.out - i.in : i.duration;
  const identity = manifest?.identity || {};
  const text = (id, value, expected, field) => { if (value != null && value !== expected) add(id, `card ${field} must match supplied manifest/proof text exactly`); };
  const card = (id, c) => {
    if (!c || !CARD_TYPES.includes(c.type)) { add(id, `invalid card.type: ${c?.type}`); return; }
    const proof = c.proofId ? proofs.get(c.proofId) : null;
    if (c.proofId && !proof) add(id, `unknown proofId: ${c.proofId}`);
    if (c.type === "booking" || c.type === "title" && items.some((i) => i.id === id && i.kind === "card")) {
      for (const p of headshotProblems(null, manifest, { final: !draft, checkFile: false })) add(id, p.message, p.level);
    }
    if (c.type === "title") for (const k of ["name", "roleLine", "tagline"]) text(id, c[k], identity[k] || "", k);
    if (c.type === "booking") {
      const mode = c.mode || identity.bookingMode;
      if (!["direct", "bureau"].includes(mode)) add(id, "booking mode must be direct or bureau");
      const expected = { name: identity.name, roleLine: identity.roleLine || "", text: identity.bookingText || "", url: mode === "bureau" ? identity.bureau?.url || "" : identity.bookingUrl || "", email: identity.email || "", phone: identity.phone || "", bureauName: identity.bureau?.name || "" };
      for (const [k, v] of Object.entries(expected)) text(id, c[k], v, k);
      if (mode === "bureau" && (c.email || c.phone || c.url && c.url === identity.bookingUrl)) add(id, "bureau booking card cannot carry direct contact details");
    }
    if (c.type === "testimonial-name") {
      if (proof && proof.kind !== "testimonial-video") add(id, "testimonial-name needs a testimonial-video proof item");
      if (!c.proofId && !String(c.name || "").trim()) add(id, "testimonial-name needs a proofId or a supplied attribution name");
      const attributions = proof ? [proof.attribution || {}] : (manifest.proof || []).filter((p) => p.kind === "testimonial-video").map((p) => p.attribution || {});
      if (!attributions.some((a) => ["name", "title", "org"].every((k) => c[k] == null || c[k] === (a[k] || "")))) add(id, "testimonial attribution must match a proof item");
    }
    if (c.type === "quote") {
      const p = proof || (manifest.proof || []).find((p) => p.kind === "quote" && p.text === c.text);
      if (!p || p.kind !== "quote") add(id, "quote must reference exact quote proof");
      else {
        if (String(p.text || "").trim().split(/\s+/).filter(Boolean).length > 25) add(id, "quote exceeds 25 words");
        text(id, c.text, p.text, "text");
        for (const k of ["name", "title", "org"]) text(id, c[k], p.attribution?.[k] || "", k);
      }
    }
    if (c.type === "topic") {
      const allowed = [...Object.entries(identity).filter(([key, v]) => !["headshot", "headshotRights"].includes(key) && typeof v === "string").map(([, v]) => v), ...(manifest.proof || []).map((p) => p.text)];
      if (!c.text || !allowed.includes(c.text)) add(id, "topic text must come from manifest identity or proof");
    }
    if (c.type === "logo-wall") {
      if (!LOGO_RELATIONSHIPS.includes(c.relationship)) add(id, "logo-wall relationship is invalid");
      const logos = Array.isArray(c.logos) ? c.logos : [];
      if (logos.length < 3 || logos.length > 6 || new Set(logos).size !== logos.length) add(id, "logo-wall needs 3 to 6 distinct logos");
      for (const pid of logos) if (proofs.get(pid)?.kind !== "logo" || proofs.get(pid)?.relationship !== c.relationship) add(id, `logo ${pid} must have the same relationship as its heading`);
      const headings = { "spoke-at": "Spoke at", client: "Clients", "featured-in": "Featured in", "available-at": "Available at" };
      if (c.heading !== headings[c.relationship]) add(id, "logo-wall heading must honestly name its relationship");
    }
  };
  const range = (i) => {
    const s = sources.get(i.sourceId), meta = sourceRow(index, i.sourceId);
    if (!s) { add(i.id, `unknown sourceId: ${i.sourceId}`); return; }
    if (!meta) add(i.id, `source ${i.sourceId} is not indexed`);
    if (!finite(i.in) || !finite(i.out) || i.in < 0 || i.in >= i.out) add(i.id, "source range requires 0 <= in < out");
    if (meta && s.kind !== "photo" && (!finite(meta.duration) || i.out > meta.duration + 0.000001)) add(i.id, `out ${i.out} is past source ${i.sourceId} duration ${meta.duration}`);
    if (i.fit != null && !["contain", "cover"].includes(i.fit)) add(i.id, `invalid fit: ${i.fit}`);
    if (i.fit === "cover" && meta && (!(meta.width > meta.height))) add(i.id, `cover requires a landscape source; ${i.sourceId} must use contain`);
  };
  for (const i of [...items, ...overlays, ...cutaways]) {
    if (!i || typeof i !== "object") { add("plan", "timeline entries must be objects"); continue; }
    if (typeof i.id !== "string" || !i.id.trim()) add("plan", "entry id is missing");
    else if (allIds.has(i.id)) add(i.id, "duplicate timeline id");
    else if (!/^[a-zA-Z0-9_-]+$/.test(i.id)) add(i.id, "timeline id must use letters, numbers, underscores or hyphens");
    allIds.add(i.id);
  }
  for (const i of items) {
    if (!["clip", "card"].includes(i.kind)) add(i.id, `invalid item.kind: ${i.kind}`);
    if (!ROLES.includes(i.role)) add(i.id, `invalid role: ${i.role}`);
    if (i.kind === "clip") {
      range(i);
      if (i.audio != null && !["source", "mute"].includes(i.audio)) add(i.id, `invalid audio: ${i.audio}`);
      if ((i.audio || "source") === "source" && sources.get(i.sourceId)?.audio !== "ok") add(i.id, `source ${i.sourceId} has no usable audio; choose mute`);
      if ((i.audio || "source") === "source" && sourceRow(index, i.sourceId)?.hasAudio === false) add(i.id, `indexed source ${i.sourceId} has no audio stream; choose mute`);
      if (i.protect != null && typeof i.protect !== "boolean") add(i.id, "protect must be true or false");
    } else if (i.kind === "card") {
      if (!finite(i.duration) || i.duration <= 0) add(i.id, "card duration must be positive seconds");
      card(i.id, i.card);
    }
    if (finite(duration(i)) && Math.round(duration(i) * 30) < 1) add(i.id, "item is shorter than one output frame");
    for (const field of ["speed", "rate"]) if (i[field] != null && i[field] !== 1) add(i.id, "speaker clips must stay at speed 1.0");
    if (i.proofId && !proofs.has(i.proofId)) add(i.id, `unknown proofId: ${i.proofId}`);
  }
  for (const o of overlays.filter(Boolean)) {
    const target = byId.get(o.at);
    if (!target) add(o.id, `unknown overlay target: ${o.at}`);
    if (!finite(o.offset) || o.offset < 0 || !finite(o.duration) || o.duration <= 0 || Math.round(o.duration * 30) < 1) add(o.id, "overlay needs non-negative offset and positive duration");
    if (target && Math.round(o.offset * 30) + Math.round(o.duration * 30) > Math.round(duration(target) * 30)) add(o.id, "overlay extends past its target item");
    card(o.id, o.card);
  }
  const intervals = new Map();
  for (const x of cutaways.filter(Boolean)) {
    range(x);
    const target = byId.get(x.over);
    if (!target || target.kind !== "clip") add(x.id, `cutaway target must be an existing clip: ${x.over}`);
    if (!finite(x.offset) || x.offset < 0) add(x.id, "cutaway offset must be non-negative");
    const start = Math.round(x.offset * 30), end = start + Math.round((x.out - x.in) * 30);
    if (end <= start) add(x.id, "cutaway is shorter than one output frame");
    if (target && end > Math.round(duration(target) * 30)) add(x.id, "cutaway extends past its target item");
    const previous = intervals.get(x.over) || [];
    for (const old of previous) if (start < old.end && end > old.start) add(x.id, `cutaway overlaps ${old.id}`);
    previous.push({ id: x.id, start, end }); intervals.set(x.over, previous);
  }
  if (items.length && items.every((i) => i && ["clip", "card"].includes(i.kind))) {
    const usage = planUsage({ ...plan, items, overlays: overlays.filter(Boolean), cutaways: cutaways.filter(Boolean) }, manifest);
    const rights = new Map((manifest.rights || []).map((r) => [r.id, r]));
    for (const item of [...usage.sourceIds.map((id) => sources.get(id)), ...usage.proofIds.map((id) => proofs.get(id))].filter(Boolean)) {
      const right = rights.get(item.rights);
      if (!right || right.status !== "approved") add(item.id, `rights ${item.rights || "(missing)"} are ${right?.status || "missing"}${draft ? "; draft only" : "; approved rights required"}`, draft && right ? "warn" : "error");
    }
  }
  if (plan.music) {
    if (!(manifest.music || []).some((m) => m.file === plan.music.file && String(m.license || "").trim())) add("music", "track must be listed with a licence in manifest.music; draft music skipped", draft ? "warn" : "error");
    if (!Array.isArray(plan.music.sections)) add("music", "music.sections must be an array");
    for (const s of Array.isArray(plan.music.sections) ? plan.music.sections : []) {
      if (!s || typeof s !== "object") { add("music", "music sections must be objects"); continue; }
      if (!byId.has(s.from) || !byId.has(s.to) || items.indexOf(byId.get(s.from)) > items.indexOf(byId.get(s.to))) add("music", "section from/to must name items in playback order");
      if (!finite(s.gainDb) || s.gainDb > 0 || s.gainDb < -96) add("music", "section gainDb must be between -96 and 0");
    }
  }
  return problems;
}

export function resolvePlan(plan, options) {
  const problems = validatePlan(plan, options);
  const errors = problems.filter((p) => p.level === "error");
  if (errors.length) throw new Error(errors.map((p) => `${p.id}: ${p.message}`).join("\n"));
  const fps = plan.canvas.fps;
  let frame = 0;
  const timing = (startFrame, frames) => ({ startFrame, endFrame: startFrame + frames, frames, start: seconds(startFrame, fps), end: seconds(startFrame + frames, fps), outputStart: seconds(startFrame, fps), outputEnd: seconds(startFrame + frames, fps) });
  const items = plan.items.map((i) => {
    const frames = Math.round((i.kind === "clip" ? i.out - i.in : i.duration) * fps);
    const resolved = { ...i, ...timing(frame, frames), ...(i.kind === "clip" ? { fit: i.fit || "contain", audio: i.audio || "source", protect: i.protect === true } : {}) };
    frame += frames;
    return resolved;
  });
  const byId = new Map(items.map((i) => [i.id, i]));
  const overlays = (plan.overlays || []).map((o) => ({ ...o, ...timing(byId.get(o.at).startFrame + Math.round(o.offset * fps), Math.round(o.duration * fps)) }));
  const cutaways = (plan.cutaways || []).map((x) => ({ ...x, fit: x.fit || "contain", ...timing(byId.get(x.over).startFrame + Math.round(x.offset * fps), Math.round((x.out - x.in) * fps)) }));
  return { ...plan, items, overlays, cutaways, frames: frame, duration: seconds(frame, fps), problems };
}

export function timelineWords(resolved, index) {
  return resolved.items.filter((i) => i.kind === "clip" && i.audio !== "mute").flatMap((i) =>
    sliceWords(sourceRow(index, i.sourceId)?.words || [], i.in, i.out).map((w) => {
      const end = Math.min(i.end, i.start + w.end), frame = 1 / (resolved.canvas?.fps || 30);
      // Frame rounding can shorten a clip below its source range; a word inside it keeps at least one frame.
      const start = Math.min(i.start + w.start, Math.max(i.start, end - frame));
      return { ...w, start, end, sourceId: i.sourceId, itemId: i.id, itemEnd: i.end };
    }),
  ).filter((w) => w.end > w.start);
}

/** Existing phrase-aware line logic, then at most two 32-character lines per cue. Fast speech stays verbatim. */
export function captionFiles(words, duration, { maxChars = 32, cps = 17 } = {}) {
  const groups = groupWords(words, duration, { wordsPerLine: 6, maxChars, phraseBreaks: true, lead: 0, maxGap: 0.7 });
  const originals = new Map(words.map((w) => [`${w.start}:${w.end}`, w]));
  const lines = [];
  for (const group of groups) {
    let row = [];
    for (const cleaned of group.words) {
      // The daily-reel caption helper strips punctuation. Speaker sidecars retain the verbatim words.
      const word = originals.get(`${cleaned.start}:${cleaned.end}`) || cleaned;
      if (row.length && (row.map((w) => w.text).join(" ").length + word.text.length + 1 > maxChars || row[0].itemId !== word.itemId)) { lines.push(row); row = []; }
      row.push(word);
    }
    if (row.length) lines.push(row);
  }
  const cues = [];
  for (const line of lines) {
    const text = line.map((w) => w.text).join(" ");
    const start = line[0].start, end = line.at(-1).end, itemId = line[0].itemId;
    const old = cues[cues.length - 1];
    if (old && old.itemId === itemId && old.lines.length < 2 && start - old.end <= 0.7 && end - old.start <= 5) {
      old.lines.push(text); old.end = end;
    } else cues.push({ start, end, lines: [text], itemId, itemEnd: line[0].itemEnd ?? duration });
  }
  for (let i = 0; i < cues.length; i++) {
    const cue = cues[i], next = cues[i + 1];
    cue.end = Math.min(duration, cue.itemEnd, next?.start ?? duration, Math.max(cue.end + 0.2, cue.start + cue.lines.join(" ").length / cps));
    cue.text = cue.lines.join("\n");
    cue.cps = cue.text.replace(/\n/g, " ").length / Math.max(0.001, cue.end - cue.start);
  }
  const stamp = (t, dot) => {
    const ms = Math.max(0, Math.round(t * 1000));
    return `${String(Math.floor(ms / 3600000)).padStart(2, "0")}:${String(Math.floor(ms / 60000) % 60).padStart(2, "0")}:${String(Math.floor(ms / 1000) % 60).padStart(2, "0")}${dot}${String(ms % 1000).padStart(3, "0")}`;
  };
  const blocks = (dot) => cues.map((c, i) => `${i + 1}\n${stamp(c.start, dot)} --> ${stamp(c.end, dot)}\n${c.text}\n`).join("\n");
  return { cues, srt: blocks(",") + "\n", vtt: "WEBVTT\n\n" + blocks(".") + "\n" };
}

/** Limit enlargement for contain; cover is an explicit landscape-only crop and warns above the limit. */
export function fitGeometry(meta, fit = "contain", { width = 1920, height = 1080, maxLinearScale = 1.5 } = {}) {
  if (!(meta.width > 0 && meta.height > 0)) return { width, height, scale: 1, warning: null, filter: `scale=${width}:${height},setsar=1` };
  if (!["contain", "cover"].includes(fit)) throw new Error(`invalid fit: ${fit}`);
  if (fit === "cover" && meta.width <= meta.height) throw new Error("cover requires landscape footage");
  const sar = String(meta.sampleAspectRatio || "1:1").split(":").map(Number);
  const pixelAspect = sar[0] > 0 && sar[1] > 0 ? sar[0] / sar[1] : 1;
  const sourceWidth = meta.width * (meta.rotationCw % 180 === 90 ? 1 / pixelAspect : pixelAspect);
  const desired = (fit === "cover" ? Math.max : Math.min)(width / sourceWidth, height / meta.height);
  const scale = fit === "contain" ? Math.min(desired, maxLinearScale) : desired;
  const even = (n) => Math.max(2, Math.round(n / 2) * 2);
  const w = even(sourceWidth * scale), h = even(meta.height * scale);
  return { width: w, height: h, scale, warning: desired > maxLinearScale + 0.0001 ? `requested ${desired.toFixed(2)}x enlargement${fit === "contain" ? `; limited to ${maxLinearScale}x in a brand frame` : "; review the landscape crop"}` : null, filter: `scale=${w}:${h}:flags=lanczos,setsar=1` };
}

/** Averaging opposite-phase microphones can erase speech. Pick the louder channel when that happens. */
export function safeMonoFilter({ leftDb, rightDb, mixDb }) {
  const louder = Math.max(leftDb, rightDb);
  if (louder > -90 && mixDb < louder - 12) return `pan=mono|c0=c${rightDb > leftDb ? 1 : 0}`;
  return "pan=mono|c0=0.5*c0+0.5*c1";
}

function stereoStats(file) {
  const fd = fs.openSync(file, "r"), buffer = Buffer.alloc(8 * 8192);
  let left = 0, right = 0, mix = 0, count = 0, n;
  try {
    while ((n = fs.readSync(fd, buffer, 0, buffer.length, null)) > 0) for (let i = 0; i + 8 <= n; i += 8) {
      const l = buffer.readFloatLE(i), r = buffer.readFloatLE(i + 4);
      left += l * l; right += r * r; mix += ((l + r) / 2) ** 2; count++;
    }
  } finally { fs.closeSync(fd); }
  const db = (sum) => sum > 0 && count ? 10 * Math.log10(sum / count) : -120;
  return { leftDb: db(left), rightDb: db(right), mixDb: db(mix) };
}

async function preparedAudio(file, source, meta, item, dir) {
  const output = path.join(dir, `${item.id}.wav`), raw = path.join(dir, `${item.id}.f32`);
  const duration = item.frames / 30, samples = item.frames * 1600;
  if (source.audio !== "ok" || item.audio === "mute" || !meta.hasAudio) {
    await run("ffmpeg", ["-y", "-loglevel", "error", "-f", "lavfi", "-i", "anullsrc=r=48000:cl=stereo", "-t", String(duration), "-c:a", "pcm_s16le", output], { capture: true });
    return output;
  }
  const stream = source.audioStream ?? meta.audioStream ?? meta.audioStreams?.[0]?.index;
  if (stream == null) throw new Error(`${item.id}: audio stream is missing`);
  try {
    // Preserve packet offsets relative to the source origin, then lock samples to video frames.
    await run("ffmpeg", ["-y", "-loglevel", "error", "-ss", String(item.in), "-i", file, "-map", `0:${stream}`, "-vn", "-t", String(duration), "-af", `aresample=48000:async=1:first_pts=0,apad,atrim=end_sample=${samples}`, "-ac", "2", "-f", "f32le", raw], { capture: true });
    const mono = safeMonoFilter(stereoStats(raw));
    if (!mono.includes("0.5")) warn(`${item.id}: stereo cancellation detected; using the louder channel`);
    const common = ["-y", "-loglevel", "error", "-f", "f32le", "-ar", "48000", "-ac", "2", "-i", raw];
    await run("ffmpeg", [...common, "-af", `${mono},pan=stereo|c0=c0|c1=c0`, "-c:a", "pcm_s16le", output], { capture: true });
    const loudness = await measureLoudness(output);
    // Fixed gain preserves pauses and real reactions; no denoise, compression or silence cutting.
    const gain = loudness.i != null && loudness.i > -65 ? Math.min(24, -16 - loudness.i, loudness.tp == null ? 24 : -1.5 - loudness.tp) : 0;
    await run("ffmpeg", [...common, "-af", `${mono},volume=${gain}dB,pan=stereo|c0=c0|c1=c0,apad,atrim=end_sample=${samples},afade=t=in:d=0.01,afade=t=out:st=${Math.max(0, duration - 0.01)}:d=0.01`, "-c:a", "pcm_s16le", output], { capture: true });
    return output;
  } finally { fs.rmSync(raw, { force: true }); }
}

async function encode(common, tail, encoder) {
  const hw = encoder === "videotoolbox" || encoder === "auto" && process.platform === "darwin" && process.env.REEL_SW_ENCODE !== "1";
  if (hw) {
    try { await run("ffmpeg", [...common, "-c:v", "h264_videotoolbox", "-q:v", "72", "-allow_sw", "1", "-metadata:s:v:0", "rotate=0", ...tail], { capture: true }); return "videotoolbox"; }
    catch (e) { if (encoder === "videotoolbox") throw e; warn("speaker: VideoToolbox unavailable; using libx264"); }
  }
  await run("ffmpeg", [...common, "-c:v", "libx264", "-preset", "fast", "-crf", "18", "-x264-params", "colorprim=bt709:transfer=bt709:colormatrix=bt709", "-metadata:s:v:0", "rotate=0", ...tail], { capture: true });
  return "libx264";
}

async function verifyStreams(file, frames, id) {
  const meta = await probeSource(file), expected = frames / 30;
  const audio = meta.audioStreams?.[0];
  if (Math.abs(meta.videoDuration - expected) > 1 / 30 + 0.0001 || !audio || Math.abs(audio.duration - meta.videoDuration) > 1 / 30 + 0.0001) throw new Error(`${id}: A/V duration mismatch (video ${meta.videoDuration}s, audio ${audio?.duration}s, expected ${expected}s)`);
}

/** Each item is encoded once after rotation, SDR conversion and one scale. Cutaways share its dialogue stem. */
export async function compileVersion(folder, plan, { manifest, index, preset = null, tokens = null, draft = false, encoder = "auto", print = warn } = {}) {
  assertNoGreg(manifest, "manifest");
  if (preset) assertNoGreg(preset, "preset");
  const resolved = resolvePlan(plan, { manifest, index, draft });
  const brand = readJSON(assetPath(folder, manifest.brand.file));
  assertNoGreg(brand, "brand");
  if (!tokens) tokens = resolveBrandTokens({ preset: preset || {}, brand });
  assertNoGreg(tokens, "brand tokens");
  const bg = tokens.colors?.surface;
  if (!/^#[0-9a-f]{6}$/i.test(bg || "")) throw new Error("speaker brand: surface must be a six-digit hex colour");
  const dir = ensureDir(path.join(folder, "work", resolved.version));
  const scratch = ensureDir(path.join(dir, "compile"));
  const sourceById = new Map(manifest.sources.map((s) => [s.id, s]));
  const normalized = new Map();
  let chosenEncoder = encoder;
  const input = async (id) => {
    if (normalized.has(id)) return normalized.get(id);
    const s = sourceById.get(id), meta = sourceRow(index, id), original = assetPath(folder, s.path);
    let file = original, hdr = meta.hdr, rotation = meta.rotationCw || 0;
    if (meta.hdrKind === "pq") {
      const mapped = path.join(scratch, `hdr-${normalized.size}.mp4`);
      if (await toneMapToSdr(original, mapped, meta)) { file = mapped; hdr = false; rotation = 0; }
      else {
        const message = `${id}: PQ tone mapping unavailable; using the existing SDR fallback; review colour`;
        print(message); resolved.problems.push({ level: "warn", id, message });
      }
    }
    const result = { file, hdr, rotation, source: s, meta };
    normalized.set(id, result);
    return result;
  };
  const files = [];
  for (const [number, item] of resolved.items.entries()) {
    if (!/^[a-zA-Z0-9_-]+$/.test(item.id)) throw new Error(`${item.id}: item id must use letters, numbers, underscores or hyphens`);
    const duration = item.frames / 30;
    const picture = item.kind === "clip" ? await input(item.sourceId) : null;
    // Silent cards and audio-only sources occupy an honest brand-colour frame.
    const args = ["-y", "-loglevel", "error", "-filter_complex_threads", "1"];
    const filters = [];
    let inputCount = 0;
    const addPicture = async (entry, frames, label) => {
      const data = await input(entry.sourceId);
      if (!data.meta.hasVideo && !data.meta.width) {
        args.push("-f", "lavfi", "-i", `color=c=${bg}:s=1920x1080:r=30:d=${frames / 30}`);
        filters.push(`[${inputCount++}:v]setsar=1[${label}]`); return;
      }
      if (data.source.kind === "photo") args.push("-loop", "1", "-framerate", "30");
      args.push("-noautorotate", "-ss", String(entry.in), "-i", data.file);
      const g = fitGeometry(data.meta, entry.fit);
      if (g.warning) { const message = `${entry.id}: ${g.warning}`; print(message); resolved.problems.push({ level: "warn", id: entry.id, message }); }
      filters.push(`[${inputCount++}:v]setpts=PTS-STARTPTS,${[
        ...rotateFilters(data.rotation), data.hdr ? SDR_FILTER : ["smpte170m", "bt470bg"].includes(data.meta.colorSpace) ? `colorspace=iall=${data.meta.colorSpace}:all=bt709:format=yuv420p` : null, "fps=30:start_time=0:round=near", g.filter,
        entry.fit === "cover" ? "crop=1920:1080" : `pad=1920:1080:(ow-iw)/2:(oh-ih)/2:color=${bg}`,
        "format=yuv420p", "setparams=range=limited:color_primaries=bt709:color_trc=bt709:colorspace=bt709", "tpad=stop_mode=clone:stop_duration=1", `trim=end_frame=${frames}`, "setpts=N/(30*TB)",
      ].filter(Boolean).join(",")}[${label}]`);
    };
    if (picture) await addPicture(item, item.frames, "picture0");
    else {
      args.push("-f", "lavfi", "-i", `color=c=${bg}:s=1920x1080:r=30:d=${duration}`);
      filters.push(`[${inputCount++}:v]setsar=1[picture0]`);
    }
    const cuts = resolved.cutaways.filter((x) => x.over === item.id).sort((a, b) => a.startFrame - b.startFrame);
    let label = "picture0";
    for (const [n, x] of cuts.entries()) {
      await addPicture(x, x.frames, `cut${n}`);
      const start = (x.startFrame - item.startFrame) / 30, end = (x.endFrame - item.startFrame) / 30;
      filters.push(`[cut${n}]setpts=PTS+${start}/TB[shift${n}]`);
      filters.push(`[${label}][shift${n}]overlay=0:0:eof_action=pass:repeatlast=0:enable='gte(t,${start})*lt(t,${end})'[picture${n + 1}]`);
      label = `picture${n + 1}`;
    }
    const audio = picture ? await preparedAudio(assetPath(folder, picture.source.path), picture.source, picture.meta, item, scratch)
      : await preparedAudio(null, { audio: "none" }, {}, item, scratch);
    args.push("-i", audio);
    const output = path.join(scratch, `${String(number).padStart(4, "0")}.mov`);
    chosenEncoder = await encode([...args, "-filter_complex", filters.join(";"), "-map", `[${label}]`, "-map", `${inputCount}:a:0`, "-r", "30", "-fps_mode", "cfr", "-frames:v", String(item.frames)], ["-pix_fmt", "yuv420p", ...SDR_TAGS, "-c:a", "pcm_s16le", "-ar", "48000", "-ac", "2", output], chosenEncoder);
    await verifyStreams(output, item.frames, item.id);
    files.push(output);
  }
  const list = path.join(scratch, "concat.txt");
  fs.writeFileSync(list, files.map((file) => `file '${file.replace(/'/g, "'\\''")}'`).join("\n") + "\n");
  const base = path.join(dir, "base.mp4"), temporary = path.join(dir, "base.pending.mp4");
  // PCM intermediates avoid accumulating one AAC priming interval per join. Re-encode the concatenation.
  await encode(["-y", "-loglevel", "error", "-f", "concat", "-safe", "0", "-i", list, "-map", "0:v:0", "-map", "0:a:0", "-vf", "setpts=N/(30*TB),setparams=range=limited:color_primaries=bt709:color_trc=bt709:colorspace=bt709", "-af", `aresample=48000:async=1:first_pts=0,apad,atrim=end_sample=${resolved.frames * 1600}`, "-r", "30", "-fps_mode", "cfr", "-frames:v", String(resolved.frames)], ["-pix_fmt", "yuv420p", ...SDR_TAGS, "-c:a", "aac", "-b:a", "192k", "-ar", "48000", "-ac", "2", "-movflags", "+faststart", temporary], chosenEncoder);
  await verifyStreams(temporary, resolved.frames, resolved.version);
  fs.renameSync(temporary, base);
  const map = [...resolved.items.map((i) => ({ itemId: i.id, kind: i.kind, sourceId: i.sourceId ?? null, in: i.in ?? null, out: i.out ?? null, start: i.start, end: i.end, outputStart: i.start, outputEnd: i.end, role: i.role })),
    ...resolved.cutaways.map((x) => ({ itemId: x.over, cutawayId: x.id, kind: "cutaway", sourceId: x.sourceId, in: x.in, out: x.out, start: x.start, end: x.end, outputStart: x.start, outputEnd: x.end, role: resolved.items.find((i) => i.id === x.over).role, pictureOnly: true }))];
  const words = timelineWords(resolved, index), captions = captionFiles(words, resolved.duration);
  writeJSON(path.join(dir, "map.json"), map);
  writeJSON(path.join(dir, "words.json"), words);
  writeJSON(path.join(dir, "plan.resolved.json"), resolved);
  fs.writeFileSync(path.join(dir, "captions.srt"), captions.srt);
  fs.writeFileSync(path.join(dir, "captions.vtt"), captions.vtt);
  if (captions.cues.some((c) => c.cps > 17.5)) print(`${resolved.version}: some verbatim caption cues exceed 17 characters/second; review reading speed`);
  if (plan.music?.sections?.length) print(`${resolved.version}: music sections are preserved in the plan for composition; base.mp4 contains dialogue only`);
  return { base, workDir: dir, map, words, resolvedPlan: resolved, plan: resolved, captions };
}
