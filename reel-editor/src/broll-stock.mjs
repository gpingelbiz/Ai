import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { claudeLook, firstJSON } from "./claude.mjs";
import { measureMotion } from "./broll-runway.mjs";
import { timeLabel } from "./broll-qc.mjs";
import { checkPick, brollStep, subjectWords } from "./broll.mjs";
import { reviewMovingClip, saveLibraryClip, readLibrary, recentLibraryReels } from "./broll-library.mjs";
import { readJSON, writeJSON, sha1, run, warn, r3 } from "./util.mjs";

const DAY = 24 * 60 * 60 * 1000;
const MB = 1024 * 1024;
const WIKIMEDIA_AGENT = "reel-editor/1.0 (gpingelbiz private editor; contact via https://github.com/gpingelbiz)";
let wikimediaActive = 0;
const wikimediaQueue = [];
// Searches and asset bodies share the same three slots, including across reels in this process.
async function wikimediaSlot(task) {
  if (wikimediaActive >= 3) await new Promise((resolve) => wikimediaQueue.push(resolve));
  else wikimediaActive++;
  try { return await task(); }
  finally { const next = wikimediaQueue.shift(); if (next) next(); else wikimediaActive--; }
}
const retryAfterAt = (response, now) => {
  const retry = response.headers?.get("retry-after");
  return retry ? (/^\d+(\.\d+)?$/.test(retry) ? now() + Number(retry) * 1000 : Date.parse(retry)) || 0 : 0;
};
function writeWikimediaRate(file, rate) {
  let previous; try { previous = readJSON(file); } catch {}
  writeJSON(file, { ...rate, blockedUntil: Math.max(rate.blockedUntil || 0, previous?.blockedUntil || 0) });
}
const plainText = (value) => String(value || "").replace(/<[^>]*>/g, " ").replace(/&(#x[\da-f]+|#\d+|amp|quot|apos|lt|gt|nbsp|ndash|mdash);/gi, (entity, code) => {
  if (code.startsWith("#")) { const n = code[1].toLowerCase() === "x" ? parseInt(code.slice(2), 16) : Number(code.slice(1)); return n > 0 && n <= 0x10ffff ? String.fromCodePoint(n) : " "; }
  return { amp: "&", quot: '"', apos: "'", lt: "<", gt: ">", nbsp: " ", ndash: "–", mdash: "—" }[code.toLowerCase()] || entity;
}).replace(/\s+/g, " ").trim();
const metadataText = (metadata, key) => plainText(metadata?.[key]?.value);

/** Only licences this editor can publish with complete credits enter the candidate pool. */
export function wikimediaLicence(metadata = {}) {
  const names = ["LicenseShortName", "License", "UsageTerms"].map((key) => metadataText(metadata, key));
  const terms = names.join(" ").toLowerCase();
  if (/\b(sa|nc|nd|share[ -]?alike|non[ -]?commercial|no[ -]?derivatives?|fair use)\b/.test(terms)) return null;
  const allowed = names.find((name) => /^(public domain(?: mark)?(?: 1\.0)?|pd(?:-[a-z\d-]+)?|cc0(?: 1\.0)?|cc-zero|cc[ -]by(?:[ -]\d+(?:\.\d+)?)?|creative commons attribution(?: \d+(?:\.\d+)?)?(?: international)?)$/i.test(name));
  if (!allowed) return null;
  const creator = metadataText(metadata, "Artist"), licenseUrl = metadataText(metadata, "LicenseUrl");
  if (/^(cc[ -]by|creative commons attribution)/i.test(allowed) && (!creator || !/^https?:\/\//i.test(licenseUrl))) return null;
  return { creator, licenseShortName: names[0] || allowed, licenseUrl };
}

function normaliseWikimedia(body) {
  return Object.values(body.query?.pages || {}).flatMap((page) => {
    const info = page.videoinfo?.[0] || page.imageinfo?.[0];
    if (!info) return [];
    const licence = wikimediaLicence(info.extmetadata);
    const duration = Number(info.duration);
    if (!licence || !/^(video\/(webm|ogg|mp4)|application\/ogg)$/.test(info.mime) || info.mediatype !== "VIDEO" ||
        !info.url || !(info.size > 0 && info.size <= 200 * MB) || !Number.isFinite(duration) || duration < 2 || !(Math.min(info.width, info.height) >= 480)) return [];
    const derivatives = (info.derivatives || []).filter((d) => d.src && d.src !== info.url && /^video\/(webm|mp4)\b/.test(d.type) && d.width > 0 && d.height > 0)
      .sort((a, b) => a.width * a.height - b.width * b.height || (a.bandwidth || 0) - (b.bandwidth || 0));
    return [{ provider: "wikimedia", id: page.pageid, pageUrl: info.descriptionurl || `https://commons.wikimedia.org/wiki/${encodeURIComponent(page.title.replace(/ /g, "_"))}`,
      ...licence, duration, width: info.width, height: info.height, thumb: info.thumburl,
      tags: plainText([page.title, metadataText(info.extmetadata, "ImageDescription"), metadataText(info.extmetadata, "Categories"), ...(page.categories || []).map((c) => c.title)].join(" ")),
      preview: derivatives[0]?.src || (info.size < 40 * MB ? info.url : undefined),
      files: [{ url: info.url, width: info.width, height: info.height, fps: null }] }];
  }).filter((c) => c.thumb);
}

export const stockCacheDir = (env = process.env) => path.join(env.REEL_CACHE || path.join(os.homedir(), ".cache", "reel-editor"), "broll-stock");
const suitableFile = (f) => f.url && (f.height > f.width ? f.width >= 720 : f.width >= 1280);
// Pexels has no tags, but its page slug names the clip ("/video/a-gorilla-eating-123/").
const slugWords = (url) => String(url || "").split("/").filter(Boolean).pop()?.replace(/-?\d+$/, "").replace(/-/g, " ") || "";
export function normaliseStock(provider, body) {
  if (provider === "wikimedia") return normaliseWikimedia(body);
  const clips = provider === "pexels" ? (body.videos || []).map((v) => ({
    provider, id: v.id, pageUrl: v.url, creator: v.user?.name || "", duration: v.duration, width: v.width, height: v.height, tags: slugWords(v.url),
    files: (v.video_files || []).filter((f) => f.file_type === "video/mp4").map((f) => ({ url: f.link, width: f.width, height: f.height, fps: f.fps ?? null })), thumb: v.image,
    preview: [...(v.video_files || [])].filter((f) => f.file_type === "video/mp4" && f.link).sort((a, b) => a.width * a.height - b.width * b.height)[0]?.link,
  })) : (body.hits || []).filter((v) => v.type === "film").map((v) => {
    const variants = Object.values(v.videos || {}).filter((f) => f.url);
    const largest = [...variants].sort((a, b) => b.width - a.width)[0] || {};
    return { provider, id: v.id, pageUrl: v.pageURL, creator: v.user || "", duration: v.duration, width: largest.width, height: largest.height, tags: v.tags || "", editorsChoice: !!(v.editors_choice || v.editorsChoice || v.is_editors_choice), preview: v.videos?.tiny?.url || [...variants].sort((a, b) => a.width * a.height - b.width * b.height)[0]?.url,
      files: variants.map((f) => ({ url: f.url, width: f.width, height: f.height, fps: f.fps ?? null })), thumb: largest.thumbnail || variants.find((f) => f.thumbnail)?.thumbnail };
  });
  return clips.map((c) => ({ ...c, files: c.files.filter(suitableFile).sort((a, b) => Number(b.height > b.width) - Number(a.height > a.width) || a.width - b.width) }))
    .filter((c) => c.duration >= 3 && c.duration <= 20 && c.thumb && c.files.length)
    .sort((a, b) => Number(b.files[0].height > b.files[0].width) - Number(a.files[0].height > a.files[0].width));
}

/**
 * Whether a clip's tags name every subject word (a plural or compound counts: gorilla matches gorillas). Untagged
 * clips are unknown rather than wrong; the contact sheet check still has to see the subject.
 */
export function stockRelevance(clip, subject) {
  const tags = String(clip.tags || "").toLowerCase().split(/[^\p{L}\p{N}]+/u).filter(Boolean);
  if (!tags.length || !subject.length) return "unknown";
  return subject.every((w) => tags.some((t) => t.startsWith(w) || w.startsWith(t) && t.length >= 4)) ? "match" : "miss";
}

/** A reel has one small search allowance; cache hits do not consume API requests. 429s defer future work. */
export function createStockSearch({ env = process.env, fetchFn = fetch, now = Date.now, warnFn = warn, maxSearches = 20, stockCandidates = 12 } = {}) {
  const missing = new Set();
  let searches = 0;
  const search = (provider, query, orientation) => provider === "wikimedia" ? wikimediaSlot(() => searchProvider(provider, query, orientation)) : searchProvider(provider, query, orientation);
  async function searchProvider(provider, query, orientation) {
    const key = env[provider === "pexels" ? "PEXELS_API_KEY" : "PIXABAY_API_KEY"];
    if (provider !== "wikimedia" && !key) { if (!missing.has(provider)) { missing.add(provider); warnFn(`b-roll: ${provider} key missing; stock provider skipped`); } return []; }
    const cache = stockCacheDir(env), file = path.join(cache, `${sha1(`${provider}|${query}|${orientation || "any"}`)}.json`), rateFile = path.join(cache, `${provider}-rate.json`);
    let saved, rate;
    try { saved = readJSON(file); } catch {}
    if (saved && now() - saved.at < DAY) return normaliseStock(provider, saved.body);
    try { rate = readJSON(rateFile); } catch {}
    if (rate?.blockedUntil > now() || searches >= maxSearches) return [];
    const url = new URL(provider === "wikimedia" ? "https://commons.wikimedia.org/w/api.php" : provider === "pexels" ? "https://api.pexels.com/videos/search" : "https://pixabay.com/api/videos/");
    if (provider === "wikimedia") {
      const params = { action: "query", format: "json", formatversion: "2", generator: "search", gsrnamespace: "6", gsrlimit: "20",
        // CirrusSearch ignores OR between filemime filters and returns nothing; filetype:video covers webm, ogv and mp4.
        gsrsearch: `${query.slice(0, 100)} filetype:video`,
        prop: "videoinfo|categories", viprop: "url|size|mime|mediatype|extmetadata|derivatives", viurlwidth: "320", cllimit: "max" };
      for (const [name, value] of Object.entries(params)) url.searchParams.set(name, value);
    } else {
      url.searchParams.set(provider === "pexels" ? "query" : "q", query.slice(0, 100));
      url.searchParams.set("per_page", provider === "pixabay" ? "40" : "20");
      if (provider === "pexels") { if (orientation) url.searchParams.set("orientation", orientation); }
      else { url.searchParams.set("key", key); url.searchParams.set("video_type", "film"); url.searchParams.set("safesearch", "true"); }
    }
    searches++;
    try {
      const response = await fetchFn(url.toString(), { headers: provider === "wikimedia" ? { "User-Agent": WIKIMEDIA_AGENT } : provider === "pexels" ? { Authorization: key } : {}, signal: AbortSignal.timeout(30000) });
      const header = (name) => response.headers?.get(name);
      const remaining = header("x-ratelimit-remaining"), reset = Number(header("x-ratelimit-reset"));
      const resetAt = reset > 0 ? provider === "pexels" ? reset * 1000 : now() + reset * 1000 : 0;
      const retryAt = retryAfterAt(response, now);
      const resetOrRetry = Math.max(resetAt, retryAt || 0);
      const blockedUntil = response.status === 429 || remaining === "0" ? resetOrRetry > now() ? resetOrRetry : now() + (provider === "wikimedia" ? 5000 : provider === "pexels" ? 3600000 : 60000) : 0;
      const rateState = { limit: header("x-ratelimit-limit"), remaining, resetAt, blockedUntil };
      if (provider === "wikimedia") writeWikimediaRate(rateFile, { ...rateState, blockedUntil: Math.max(blockedUntil, retryAt) });
      else writeJSON(rateFile, rateState);
      if (!response.ok) { warnFn(`b-roll: ${provider} search HTTP ${response.status}; skipped`); return []; }
      const body = await response.json();
      if (body.error) throw new Error("stock API error");
      writeJSON(file, { at: now(), body });
      return normaliseStock(provider, body);
    } catch { warnFn(`b-roll: ${provider} search unavailable; skipped`); return []; }
  }
  // The bare subject goes first: a longer query such as "gorilla walking" matches crowds walking before gorillas.
  // Clips whose tags name a different subject are dropped; tagged matches rank ahead of untagged clips. No query may
  // fill more than two thirds of the pool, so the action query ("gorilla running") always gets places of its own.
  return async ({ stockQuery, stockSynonyms = [], shows, scene, action }, providers = ["pexels", "pixabay"]) => {
    const subject = subjectWords(shows, scene || shows), clips = [], seen = new Map();
    const actionWords = String(`${action || ""} ${stockQuery || ""}`).toLowerCase().split(/[^\p{L}\p{N}]+/u)
      .filter((w) => w.length >= 4 && !subject.some((s) => s.startsWith(w) || w.startsWith(s)));
    const actionMatch = (c) => String(c.tags || "").toLowerCase().split(/[^\p{L}\p{N}]+/u)
      .some((t) => t.length >= 4 && actionWords.some((w) => t.startsWith(w.slice(0, 4))));
    const ranked = () => [...clips].sort((a, b) => Number(b.relevance === "match") - Number(a.relevance === "match") ||
      Number(actionMatch(b)) - Number(actionMatch(a)) || Number(!!b.editorsChoice) - Number(!!a.editorsChoice) ||
      Number(b.files[0].height > b.files[0].width) - Number(a.files[0].height > a.files[0].width));
    const synonyms = Array.isArray(stockSynonyms) ? stockSynonyms.filter((s) => typeof s === "string" && s.trim()).slice(0, 3) : [];
    const queries = [subject.join(" "), stockQuery, ...synonyms], perQuery = Math.ceil(stockCandidates * 2 / 3);
    async function collect(sources, fallback = false) {
      for (const query of [...new Set(queries.map((s) => String(s || "").trim().toLowerCase()).filter(Boolean))]) {
        if (fallback && clips.length >= stockCandidates) break;
        const synonym = synonyms.some((s) => s.trim().toLowerCase() === query) ? query.split(/\s+/) : [];
        for (const provider of sources) {
          for (const orientation of provider === "pexels" ? ["portrait", null] : [null]) {
            let taken = 0;
            for (const c of await search(provider, query, orientation)) {
              if (taken >= perQuery || fallback && clips.length >= stockCandidates) break;
              const primary = stockRelevance(c, subject), relevance = primary === "match" || synonym.length && stockRelevance(c, synonym) === "match" ? "match" : primary;
              if (relevance === "miss") continue;
              const id = `${c.provider}:${c.id}`, existing = seen.get(id);
              if (existing) { if (relevance === "match") existing.relevance = relevance; }
              else { const eligible = { ...c, relevance }; seen.set(id, eligible); clips.push(eligible); taken++; }
            }
          }
        }
      }
    }
    await collect(providers.filter((p) => ["pexels", "pixabay"].includes(p)));
    if (providers.includes("wikimedia") && clips.length < stockCandidates) await collect(["wikimedia"], true);
    return ranked().slice(0, stockCandidates);
  };
}

async function download(url, file, fetchFn, provider, env = process.env, now = Date.now) {
  const task = async () => {
    const rateFile = path.join(stockCacheDir(env), "wikimedia-rate.json");
    if (provider === "wikimedia") {
      let rate; try { rate = readJSON(rateFile); } catch {}
      if (rate?.blockedUntil > now()) throw new Error("stock provider cooling down");
    }
    const response = await fetchFn(url, { ...(provider === "wikimedia" ? { headers: { "User-Agent": WIKIMEDIA_AGENT } } : {}), signal: AbortSignal.timeout(60000) });
    if (provider === "wikimedia") {
      const retryAt = retryAfterAt(response, now);
      if (response.status === 429 || retryAt > now()) writeWikimediaRate(rateFile, { blockedUntil: retryAt > now() ? retryAt : now() + 5000 });
    }
    if (!response.ok) throw new Error("stock asset download failed");
    fs.writeFileSync(file, Buffer.from(await response.arrayBuffer()));
  };
  return provider === "wikimedia" ? wikimediaSlot(task) : task();
}

/** Preview failures leave the thumbnail usable; a successful measurement can exclude a frozen source. */
export async function previewStockCandidates(candidates, { pick, dir, settings = {}, deps = {} }) {
  const env = deps.env || process.env, runner = deps.runFn || run, now = deps.now || Date.now, eligible = [];
  const cache = stockCacheDir(env);
  for (const c of candidates) {
    try {
      if (!c.preview) throw new Error("no preview");
      fs.mkdirSync(cache, { recursive: true });
      const file = path.join(cache, `${c.provider}-${c.id}.preview.mp4`);
      if (!fs.existsSync(file) || now() - fs.statSync(file).mtimeMs >= DAY) {
        const pending = `${file}.tmp`;
        try { await download(c.preview, pending, deps.fetchFn || fetch, c.provider, env, now); fs.renameSync(pending, file); fs.utimesSync(file, now() / 1000, now() / 1000); }
        finally { fs.rmSync(pending, { force: true }); }
      }
      const motion = await (deps.measureMotion || measureMotion)(file, c.duration, { runFn: runner, dir });
      if (!Number.isFinite(motion.mean)) throw new Error("motion unavailable");
      if (motion.mean < (settings.stockMinMotion ?? 2.5)) {
        brollStep(pick, `stock ${c.provider}:${c.id} skipped: still clip (motion ${r3(motion.mean)})`, deps);
        continue;
      }
      const frames = [];
      for (const fraction of [0.2, 0.5, 0.8]) {
        const frame = path.join(dir, `${c.provider}-${c.id}-${fraction}.jpg`);
        await runner("ffmpeg", ["-y", "-loglevel", "error", "-ss", String(r3(c.duration * fraction)), "-i", file, "-frames:v", "1", frame], { quiet: true });
        if (!fs.existsSync(frame)) throw new Error("preview frame missing");
        frames.push(frame);
      }
      eligible.push({ ...c, previewFrames: frames, previewMotion: r3(motion.mean) });
    } catch { eligible.push(c); }
  }
  return eligible;
}

/** Candidate numbers are drawn locally, so this works on ffmpeg builds without the drawtext filter. */
export async function stockContactSheet(candidates, { dir, deps = {} }) {
  const runner = deps.runFn || run, tiles = [], width = 540;
  for (const [i, c] of candidates.entries()) {
    const label = path.join(dir, `number-${i + 1}.ppm`), tile = path.join(dir, `tile-${i + 1}.png`);
    let frames = c.previewFrames;
    if (!frames?.length) {
      const thumb = path.join(dir, `thumb-${i + 1}.jpg`);
      await download(c.thumb, thumb, deps.fetchFn || fetch, c.provider, deps.env, deps.now);
      frames = [thumb];
    }
    timeLabel(i + 1, label, 180);
    const scaled = frames.map((_, n) => `[${n}:v]scale=${width / frames.length}:320:force_original_aspect_ratio=decrease,pad=${width / frames.length}:320:(ow-iw)/2:(oh-ih)/2[v${n}]`).join(";");
    const strip = frames.length === 1 ? "[v0]null[v]" : `${frames.map((_, n) => `[v${n}]`).join("")}hstack=inputs=${frames.length}[v]`;
    await runner("ffmpeg", ["-y", "-loglevel", "error", ...frames.flatMap((f) => ["-i", f]), "-i", label, "-filter_complex", `${scaled};${strip};[${frames.length}:v]scale=${width}:60[label];[v][label]vstack=inputs=2[out]`, "-map", "[out]", "-frames:v", "1", tile], { quiet: true });
    tiles.push(tile);
  }
  const sheet = path.join(dir, "candidates.png");
  const filter = tiles.length === 1 ? "[0:v]null[out]" : `${tiles.map((_, i) => `[${i}:v]`).join("")}xstack=inputs=${tiles.length}:layout=${tiles.map((_, i) => `${i % 4 * width}_${Math.floor(i / 4) * 380}`).join("|")}[out]`;
  await runner("ffmpeg", ["-y", "-loglevel", "error", ...tiles.flatMap((t) => ["-i", t]), "-filter_complex", filter, "-map", "[out]", "-frames:v", "1", sheet], { quiet: true });
  if (!fs.existsSync(sheet)) throw new Error("stock contact sheet missing");
  return sheet;
}

/** Stock clips often fade in from or out to black, so a clip over 4 s loses its first and last half second. */
export async function conformStockClip(input, file, { runFn = run } = {}) {
  const probe = await runFn("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "default=noprint_wrappers=1:nokey=1", input], { capture: true });
  const total = Number(probe?.out?.trim());
  const edges = total > 4 ? ["-ss", "0.5", "-t", String(r3(total - 1))] : [];
  await runFn("ffmpeg", ["-y", "-loglevel", "error", ...edges, "-i", input, "-vf", "scale=720:1280:force_original_aspect_ratio=increase,crop=720:1280", "-an", "-c:v", "libx264", "-preset", "fast", "-crf", "17", "-r", "30", "-g", "30", "-pix_fmt", "yuv420p", "-movflags", "+faststart", file], { quiet: true });
}

export async function makeStockClip({ pick, shot, groups, workDir, dir, settings = {}, search, fill = false, maxNew = 20, deps = {} }) {
  const why = checkPick(pick, shot, groups, { len: shot.duration });
  if (why) { brollStep(pick, `stock skipped: ${why}`, deps); return null; }
  const env = deps.env || process.env, look = deps.claudeLook || claudeLook;
  const approved = [];
  let stage = "search";
  try {
    const bank = readLibrary(env), recent = recentLibraryReels(bank, workDir);
    const found = await search(pick, settings.stock);
    let candidates = found.filter((c) => !bank.clips.some((l) => l.licence?.provider === c.provider && String(l.licence.id) === String(c.id) && (fill || (l.usedIn || []).some((use) => recent.has(use.reel))))).slice(0, settings.stockCandidates ?? 12);
    for (const provider of new Set([...(settings.stock || ["pexels", "pixabay"]), ...found.map((c) => c.provider)])) {
      brollStep(pick, `stock ${provider}: ${found.filter((c) => c.provider === provider).length} candidates found, ${candidates.filter((c) => c.provider === provider).length} eligible`, deps);
    }
    if (!candidates.length) { brollStep(pick, "stock choice none: no eligible candidates after search and recent-clip exclusion", deps); return null; }
    const evidence = fs.mkdtempSync(path.join(dir, "stock-"));
    candidates = await previewStockCandidates(candidates, { pick, dir: evidence, settings, deps });
    if (!candidates.length) return fill ? approved : null;
    stage = "contact sheet";
    const sheet = await (deps.stockContactSheet || stockContactSheet)(candidates, { dir: evidence, deps });
    stage = "Claude description";
    const open = firstJSON(await look(`Inspect the numbered contact sheet ${JSON.stringify(path.basename(sheet))}. Each numbered tile contains three frames in time order (20%, 50%, 80%) or a single thumbnail when the preview is unavailable. Describe only what is visibly present in each numbered tile: subject, position, surroundings and lighting. State uncertainty. Do not guess intended meaning. Reply JSON only: {"seen":"..."}`, { cwd: evidence }));
    if (typeof open.seen !== "string" || !open.seen.trim()) { brollStep(pick, "stock Claude choice none: missing independent description", deps); return null; }
    const rejected = [], selections = [];
    const saveSelection = () => writeJSON(path.join(evidence, "selection.json"), { candidates, seen: open.seen, selections });
    saveSelection();
    for (let attempt = 0; attempt < (fill ? candidates.length : 2); attempt++) {
      stage = "Claude choice";
      const result = firstJSON(await look(`Inspect ${JSON.stringify(path.basename(sheet))}. Your independent description: ${JSON.stringify(open.seen)}.
Required subject: ${JSON.stringify(pick.shows)}. Planned event (a guide, not a requirement): ${JSON.stringify(pick.action)}.
Spoken context: ${JSON.stringify(groups.filter((g) => g.start >= shot.start - 3 && g.start <= shot.start + shot.duration + 3).map((g) => g.text).join(" "))}.
Choose the image that unmistakably shows the named subject, large and clear, doing something real and harmless. Stock footage rarely shows the planned event, so a different harmless event is fine when it does not contradict the spoken words; prefer one that fits them (for "coming after me", a walk or a stare toward the lens beats eating). Name the harmless event this clip most likely shows (for example "the gorilla stares into the lens and shifts its weight"); the full clip is then checked for it. Prefer real filmed footage, natural colour, portrait framing, a large clear subject and the complete action area above captions. Reject human faces (animal faces are allowed), readable text, logos, watermarks, animation, harm, neck contact, hanging loops, threats and unsafe associations with those words. If uncertain, answer none.
Preview motion means: ${candidates.map((c, i) => `${i + 1}: ${c.previewMotion ?? "unavailable (thumbnail only)"}`).join(", ")}.
Candidate numbers are 1 through ${candidates.length}, labelled as decimals. Excluded after selection or failed clip checks: ${JSON.stringify(rejected)}.
Reply JSON only: {"choice":N|"none","event":"...","shows":true|false,"safe":true|false,"humanFaces":true|false,"readableText":true|false,"logos":true|false,"watermarks":true|false,"why":"..."}`, { cwd: evidence }));
      selections.push(result); saveSelection();
      const candidate = Number.isInteger(result.choice) && candidates[result.choice - 1];
      const choice = candidate ? `${result.choice} (${candidate.provider}:${candidate.id})` : "none";
      brollStep(pick, `stock Claude choice ${choice}: ${result.why || "no reason supplied"}`, deps);
      if (!candidate || rejected.includes(result.choice) || result.shows !== true || result.safe !== true || ["humanFaces", "readableText", "logos", "watermarks"].some((f) => result[f] !== false)) {
        brollStep(pick, "stock outcome none: Claude declined or the choice failed subject/safety checks", deps);
        return fill ? approved : null;
      }
      rejected.push(result.choice);
      const c = candidates[result.choice - 1], variant = c.files[0];
      const event = typeof result.event === "string" && result.event.trim() ? result.event.trim() : pick.action, checked = { ...pick, action: event };
      try {
        const original = path.join(evidence, `${c.provider}-${c.id}.download.mp4`), file = path.join(evidence, `${c.provider}-${c.id}.mp4`);
        stage = "download";
        await download(variant.url, original, deps.fetchFn || fetch, c.provider, env, deps.now);
        stage = "conform";
        await (deps.conformStockClip || conformStockClip)(original, file, { runFn: deps.runFn });
        stage = "duration probe";
        const probe = await (deps.runFn || run)("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "default=noprint_wrappers=1:nokey=1", file], { capture: true });
        const duration = Number(probe.out?.trim());
        if (!(c.provider === "wikimedia" ? Number.isFinite(duration) && duration >= 2 : duration >= 3 && duration <= 20)) { brollStep(pick, `stock ${c.provider}:${c.id} rejected: duration must be ${c.provider === "wikimedia" ? "at least 2" : "3–20"} seconds`, deps); continue; }
        stage = "full and trimmed clip inspection";
        const accepted = await reviewMovingClip({ file, duration, pick: checked, shot, groups, dir: evidence, deps });
        if (!accepted) { brollStep(pick, `stock ${c.provider}:${c.id} rejected: full or trimmed clip failed event/look inspection (${JSON.stringify(event)})`, deps); continue; }
        const licence = { provider: c.provider, id: c.id, pageUrl: c.pageUrl, creator: c.creator,
          ...(c.provider === "wikimedia" ? { licenseShortName: c.licenseShortName, licenseUrl: c.licenseUrl } : {}), downloadedAt: new Date((deps.now || Date.now)()).toISOString() };
        const output = { ...accepted, source: c.provider, licence };
        if (settings.library || fill) {
          try {
            const saved = saveLibraryClip({ shot: output, pick: checked, workDir, licence, recordUse: !fill, env, now: (deps.now || Date.now)() });
            if (saved) output.libraryId = saved.id;
          } catch { warn("b-roll: approved stock clip could not be saved to the library"); }
        }
        brollStep(pick, `stock ${c.provider}:${c.id} accepted: full and trimmed clip passed`, deps);
        if (!fill) return output;
        if (!output.libraryId) continue;
        approved.push(output);
        if (approved.length >= maxNew) return approved;
      } catch (e) { brollStep(pick, `stock ${c.provider}:${c.id} failed at ${stage}: ${String(e.message).split("\n")[0]}; trying the next candidate`, deps); }
    }
    if (!approved.length) brollStep(pick, fill ? "stock outcome none: no chosen clip passed" : "stock outcome none: both chosen clips failed", deps);
  } catch (e) { brollStep(pick, `stock choice none: ${stage} failed: ${String(e.message).split("\n")[0]}`, deps); }
  return fill ? approved : null;
}
