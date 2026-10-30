import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn, spawnSync } from "node:child_process";
import { loadStudio, readPosts, logPost, studioLog, takeLock, parseTime, hhmm } from "./content-studio.mjs";
import { studioMix, pickJob } from "./mix.mjs";
import { copyPrompt, parseCopy, neverSaid, captionText, buildSpec, photoPlan, photoPickPrompt, parsePhotoPicks } from "./studio-copy.mjs";
import { photoPool, pickPhotos, exportPhoto, contactSheet, markUsed, skipSummary } from "./photos.mjs";
import { scheduledPosts, postInput, createPost, detectConnectors } from "./studio-metricool.mjs";
import { hostFiles } from "./studio-host.mjs";
import { codexExec, hasCodex, codexPausedUntil, imageInstructions, savedImage } from "./codex.mjs";
import { ensureDir, writeJSON, log, warn } from "./util.mjs";

/**
 * `reel daily`: the Content Studio's daily run on the client's Mac (launchd, every morning). For every open posting
 * slot in the next few days it picks the job from the client's brand-guide mix, has Claude write the post in the
 * client's voice, picks unused photos (the face finder skips bad shots, Claude matches photos to slides from a
 * contact sheet), renders the slides with `reel slides` in the client's brand, puts a copy in Made/ and schedules it
 * into the client's Metricool. Nobody reviews it; what code can check, code checks, and a post that fails a check
 * goes in as a Metricool draft with the reason instead of posting.
 */

const DENY = ["Bash", "Edit", "Write", "Glob", "Grep", "WebFetch", "WebSearch", "Task", "NotebookEdit", "TodoWrite"];

/** The wall clock in a time zone: {day: "YYYY-MM-DD", minutes since midnight}. */
export function zonedNow(tz, now = new Date()) {
  const p = Object.fromEntries(new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(now).map((x) => [x.type, x.value]));
  return { day: `${p.year}-${p.month}-${p.day}`, minutes: Number(p.hour) * 60 + Number(p.minute) };
}

export const addDays = (day, n) => new Date(Date.parse(`${day}T12:00:00Z`) + n * 86400000).toISOString().slice(0, 10);

/**
 * The slots to fill: every studio.json slot from today (only when it is at least `leadMin` away) through
 * today + daysAhead, minus slots the log already has a post for and slots where Metricool already holds a post
 * within 2 hours (one the client made by hand counts; reels do not, they find their own hour). Oldest first.
 */
export function openSlots({ config, posts = [], scheduled = [], now = new Date(), leadMin = 180, day: onlyDay = null }) {
  const tz = config.timezone;
  const { day: today, minutes } = zonedNow(tz, now);
  const taken = new Set(posts.filter((p) => p.status !== "failed").map((p) => `${p.day} ${p.time}`));
  const out = [];
  // One named day (reel daily --day): only that day's slots, however far ahead.
  const days = onlyDay ? (onlyDay >= today ? [onlyDay] : []) : Array.from({ length: Number(config.daysAhead) + 1 }, (_, k) => addDays(today, k));
  for (const day of days) {
    const k = day === today ? 0 : 1;
    for (const s of config.slots) {
      const t = parseTime(s.time);
      const at = t.h * 60 + t.m;
      if (k === 0 && at < minutes + leadMin) continue;
      const time = hhmm(t);
      if (taken.has(`${day} ${time}`)) continue;
      const clash = scheduled.some((p) => p.day === day && !/REEL/.test(p.type) && Math.abs(p.hour * 60 + p.minute - at) < 120);
      if (clash) continue;
      out.push({ day, time, format: s.format });
    }
  }
  return out.sort((a, b) => `${a.day} ${a.time}`.localeCompare(`${b.day} ${b.time}`));
}

/** Posts that were made but never reached Metricool, still worth sending (their slot is 30+ minutes away). */
export function retryable(posts, { tz, now = new Date() }) {
  const { day, minutes } = zonedNow(tz, now);
  return posts.filter((p) => (p.status === "made" || p.status === "not-posted") && p.made && (p.day > day || (p.day === day && parseTime(p.time).h * 60 + parseTime(p.time).m > minutes + 30)));
}

/** Headless Claude for the copy: no tools, or only Sandcastles' hook lookups when the client has the connector. */
function claudeCopy(prompt, { sandcastles = "" } = {}) {
  const tools = sandcastles ? [`mcp__claude_ai_${sandcastles.replace(/[^A-Za-z0-9]+/g, "_")}__top_hooks`, `mcp__claude_ai_${sandcastles.replace(/[^A-Za-z0-9]+/g, "_")}__top_formats`] : [];
  const args = tools.length
    ? ["-p", prompt, "--allowedTools", tools.join(","), "--disallowedTools", [...DENY, "Read"].join(","), "--output-format", "text"]
    : ["-p", prompt, "--tools", "", "--strict-mcp-config", "--output-format", "text"];
  return runClaude(args);
}

function runClaude(args, timeoutMs = 300000) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.env.REEL_CLAUDE_BIN || "claude", args, { stdio: ["ignore", "pipe", "pipe"], cwd: os.tmpdir() });
    let out = "", err = "";
    const timer = setTimeout(() => { child.kill("SIGTERM"); reject(new Error("claude timed out")); }, timeoutMs);
    child.stdout.on("data", (d) => (out += d));
    child.stderr.on("data", (d) => (err += d));
    child.on("error", (e) => { clearTimeout(timer); reject(e); });
    child.on("close", (code) => { clearTimeout(timer); code === 0 ? resolve(out) : reject(new Error(`claude exited ${code}: ${(err || out).trim().slice(-300)}`)); });
  });
}

const notify = (title, msg) => { try { spawnSync("osascript", ["-e", `display notification ${JSON.stringify(msg)} with title ${JSON.stringify(title)}`]); } catch {} };

/** Copy for one slot, with one retry that tells Claude what was wrong. */
export async function writeCopy(studio, slot, job, { posts, sandcastles, write = claudeCopy } = {}) {
  const recent = posts.filter((p) => p.hook).slice(-20).map((p) => `${p.day} ${p.job}: ${p.hook}${p.angle ? ` (${p.angle})` : ""}`);
  const base = copyPrompt({
    format: slot.format, job, client: studio.config.client, handle: studio.tokens.identity?.handle || "", guide: studio.guide, voice: studio.voice,
    recent, slides: studio.config.carouselSlides, cta: studio.config.cta || studio.brand.cta || "", neverSay: studio.config.neverSay, date: slot.day,
  });
  const prompt = sandcastles ? `${base}\n\nBefore writing, you may call the Sandcastles top_hooks tool with scope "all" (never "watchlist") and a query naming this post's topic, at most twice, and model the hook on a winning pattern without copying anyone's words.` : base;
  let reply = await write(prompt, { sandcastles });
  try {
    return parseCopy(reply, { format: slot.format, slides: studio.config.carouselSlides });
  } catch (e) {
    reply = await write(`${prompt}\n\nYour last reply could not be used: ${e.message}. Reply again with JSON only.`, { sandcastles });
    return parseCopy(reply, { format: slot.format, slides: studio.config.carouselSlides });
  }
}

/**
 * Photos for the slides. Candidates are the best unused photos from different moments; Claude looks at a numbered
 * contact sheet and matches them to slides (and vetoes any that must never be posted); without Claude the best
 * face goes on the cover and the rest in order. Returns {bySlide: [photo|null], vetoed: [photo]}.
 */
export async function choosePhotos(studio, copy, { workDir, pick = true, pool: given } = {}) {
  const pool = given || await photoPool(studio.photos, { checksFile: studio.paths.checks, ledgerFile: studio.paths.used });
  const candidates = pickPhotos(pool.usable, 24);
  const plan = photoPlan(copy, candidates.length);
  const bySlide = copy.slides.map(() => null);
  const vetoed = [];
  if (!plan.length) return { bySlide, vetoed, pool };
  let picks = null;
  if (pick) {
    try {
      const sheet = await contactSheet(candidates.map((c) => c.file), path.join(workDir, "photo-sheet.jpg"));
      const reply = await runClaude(["-p", photoPickPrompt({ sheet, count: candidates.length, copy, plan, guide: studio.guide }), "--tools", "Read", "--allowedTools", "Read", "--strict-mcp-config", "--output-format", "text"], 240000);
      const r = parsePhotoPicks(reply, { plan, count: candidates.length });
      for (const [i, why] of r.never) vetoed.push({ ...candidates[i], vetoWhy: why });
      picks = r.picks;
    } catch (e) {
      warn(`photo pick: ${e.message}; using the best photos in order`);
    }
  }
  const banned = new Set(vetoed.map((v) => v.key));
  const used = new Set();
  if (picks) for (const [si, pi] of picks) { bySlide[si] = candidates[pi]; used.add(pi); }
  // Slides Claude left empty (or every slide, without Claude) take the best remaining candidates in order.
  let next = 0;
  for (const si of plan) {
    if (bySlide[si]) continue;
    while (next < candidates.length && (used.has(next) || banned.has(candidates[next].key) || bySlide.some((p) => p?.moment === candidates[next].moment))) next++;
    if (next < candidates.length) { bySlide[si] = candidates[next]; used.add(next); next++; }
  }
  return { bySlide, vetoed, pool };
}

/** Codex stills for slides that have no photo, when the client's studio allows AI pictures and Codex is set up. */
async function drawStills(studio, copy, bySlide, workDir) {
  const allow = studio.config.ai?.broll;
  if (allow === false || !hasCodex() || codexPausedUntil()) return [];
  const want = copy.slides.map((s, i) => (!bySlide[i] && ["point", "close"].includes(s.role) ? i : null)).filter((i) => i != null).slice(0, 2);
  if (!want.length) return [];
  const dir = ensureDir(path.join(workDir, "stills"));
  const world = String(studio.brand.world || "").trim();
  const style = String(studio.brand.carouselStyle || studio.brand.brollStyle || "").trim();
  const prompt = [
    `Make ${want.length} picture${want.length > 1 ? "s" : ""} for an Instagram carousel${world ? ` by someone whose world is: ${world}` : ""}.`,
    ...want.map((i, k) => `- still-${k + 1}.png: a literal, everyday scene that shows this point: ${copy.slides[i].headline.replace(/\*/g, "")}${copy.slides[i].body ? `. ${copy.slides[i].body}` : ""}`),
    imageInstructions({ aspect: "4:5", style: style ? `${style}. Candid, phone-shot, real places, no faces.` : "" }),
  ].join("\n");
  try {
    await codexExec(prompt, { cwd: dir, timeoutMs: 900000 });
  } catch (e) {
    warn(`AI pictures: ${e.message}`);
    return [];
  }
  const out = [];
  want.forEach((i, k) => { const f = savedImage(dir, `still-${k + 1}.png`); if (f) { bySlide[i] = { file: f, key: null, ai: true }; out.push(i); } });
  return out;
}

/** The Made/ folder name: "2026-11-02 10.00 Carousel - Stop guessing your prices". */
export function madeName(slot, hook) {
  const h = String(hook || "").replace(/\*/g, "").replace(/[/:\\*?"<>|]+/g, " ").replace(/\s+/g, " ").trim().slice(0, 48).trim();
  return `${slot.day} ${slot.time.replace(":", ".")} ${slot.format === "static" ? "Static" : "Carousel"}${h ? ` - ${h}` : ""}`;
}

/** Make one post: copy, photos, render, Made/ copy, ledger and log. Returns the post record (status "made"). */
export async function makePost(studio, slot, { posts, connectors = {}, deps = {} } = {}) {
  const { renderSlides } = await import("./slides.mjs");
  const id = `${slot.day}-${slot.time.replace(":", "")}-${slot.format}`;
  const workDir = ensureDir(path.join(studio.paths.work, id));
  const mix = studioMix(studio.config, studio.guide);
  const job = pickJob(mix, posts.map((p) => ({ date: p.day, job: p.job })), { today: slot.day });
  log(`studio: ${slot.day} ${slot.time} ${slot.format}: job ${job.name}`);
  const copy = await (deps.writeCopy || writeCopy)(studio, slot, job, { posts, sandcastles: studio.config.sandcastles ? connectors.sandcastles : "" });
  writeJSON(path.join(workDir, "copy.json"), copy);
  const { bySlide, vetoed, pool } = await (deps.choosePhotos || choosePhotos)(studio, copy, { workDir, pick: deps.pickPhotos !== false });
  if (vetoed.length) markUsed(studio.paths.used, vetoed, { post: "never (Claude: not fit to post)", date: slot.day });
  const aiSlides = deps.drawStills === false ? [] : await drawStills(studio, copy, bySlide, workDir);
  const photos = [];
  for (const [i, p] of bySlide.entries()) {
    if (!p) continue;
    p.export = p.ai ? p.file : await exportPhoto(p.file, path.join(workDir, `photo-${i + 1}.jpg`));
    photos.push(p);
  }
  const spec = buildSpec(copy, bySlide, { format: slot.format, outDir: path.join(workDir, "slides") });
  writeJSON(path.join(workDir, "spec.json"), spec);
  const pngs = await (deps.renderSlides || renderSlides)(spec, { brand: studio.tokens, outDir: path.join(workDir, "slides") });
  const ai = studio.config.ai?.label === "always" || aiSlides.length > 0;
  const gate = neverSaid(copy, studio.config.neverSay);
  const made = ensureDir(uniqueDir(path.join(studio.paths.made, madeName(slot, copy.hook))));
  const files = pngs.map((f, i) => { const to = path.join(made, slot.format === "static" ? "Post.png" : `Slide ${i + 1}.png`); fs.copyFileSync(f, to); return to; });
  const prefix = String(studio.config.publish?.captionPrefix || "").trim();
  const text = [prefix, captionText(copy)].filter(Boolean).join("\n\n");
  fs.writeFileSync(path.join(made, "caption.txt"), text + "\n");
  const record = {
    id, day: slot.day, time: slot.time, format: slot.format, job: job.name, angle: copy.angle, hook: copy.hook, slides: files.length,
    photos: photos.filter((p) => p.key).map((p) => ({ key: p.key, file: p.file })), aiSlides, ai, draftWhy: gate ? `it uses "${gate}", which the client never says` : "",
    made, files, text, status: "made",
  };
  writeJSON(path.join(made, ".post.json"), record);
  markUsed(studio.paths.used, photos.filter((p) => p.key), { post: id, date: slot.day });
  logPost(studio.paths, record);
  studioLog(studio.paths, `made ${id}: ${job.name}, "${copy.hook}", ${files.length} slide(s), ${photos.length} photo(s)${aiSlides.length ? `, ${aiSlides.length} AI` : ""}; photo pool ${pool?.usable?.length ?? "?"} unused${pool?.skipped?.length ? ` (${skipSummary(pool.skipped)} skipped)` : ""}`);
  return record;
}

function uniqueDir(p) {
  if (!fs.existsSync(p)) return p;
  for (let i = 2; ; i++) if (!fs.existsSync(`${p} (${i})`)) return `${p} (${i})`;
}

/** Schedule a made post into the client's Metricool. Returns the updated record. */
export async function publishPost(studio, record, { connectors = {}, deps = {} } = {}) {
  const c = studio.config;
  const draft = c.publish.mode === "draft" || !!record.draftWhy;
  const host = await (deps.hostFiles || hostFiles)(record.files, { hosting: c.hosting, postId: record.id, connectors });
  try {
    const input = postInput({ blogId: c.metricool.blogId, day: record.day, time: record.time, tz: c.timezone, text: record.text, media: host.urls, kind: record.format, ai: record.ai, draft, networks: c.metricool.networks, title: record.hook, coverMs: record.coverMs });
    const r = await (deps.createPost || createPost)(c.metricool.connector || connectors.metricool, input);
    const next = { ...record, status: draft ? "draft" : "scheduled", plannerUrl: r.plannerUrl, metricoolId: r.id, why: record.draftWhy || (draft ? "the studio is set to drafts" : "") };
    fs.writeFileSync(path.join(record.made, "Scheduled.txt"), [
      draft ? `Saved as a DRAFT in Metricool (${next.why}); it will not post until it is scheduled there.` : `Scheduled to post ${record.day} at ${record.time} (${c.timezone}) on ${c.metricool.networks.join(", ")}.`,
      `Metricool: ${r.plannerUrl || "(no link returned)"}`,
      record.ai ? "Marked as made with AI (Instagram's AI label)." : "",
    ].filter(Boolean).join("\n") + "\n");
    fs.rmSync(path.join(record.made, "Not posted.txt"), { force: true });
    logPost(studio.paths, next);
    studioLog(studio.paths, `${next.status} ${record.id} ${r.plannerUrl || ""}`);
    return next;
  } finally {
    await host.close();
  }
}

/**
 * The whole daily run. Options: dryRun (make nothing, list the slots), noPublish (make and file in Made/ only),
 * only ("carousel" | "static": fill only that kind), limit (most posts this run), now (tests), deps (tests).
 */
export async function runDaily(dir, { dryRun = false, noPublish = false, only = null, limit = null, day = null, now = new Date(), deps = {} } = {}) {
  const studio = loadStudio(dir, { publishing: !noPublish && !dryRun });
  const c = studio.config;
  const release = dryRun ? () => {} : takeLock(studio.paths, "daily");
  if (!release) { log("studio: another run is going; nothing to do"); return { made: [], skipped: "locked" }; }
  try {
    const publishing = c.publish.mode !== "off" && !noPublish;
    let connectors = { metricool: c.metricool.connector };
    if (c.sandcastles || c.hosting.route === "dropbox") { try { connectors = { ...(await (deps.detectConnectors || detectConnectors)()), metricool: c.metricool.connector }; connectors = Object.fromEntries(Object.entries(connectors).map(([k, v]) => [k, typeof v === "object" ? (v?.connected ? v.name : "") : v])); } catch {} }
    const posts = readPosts(studio.paths);
    const { day: today } = zonedNow(c.timezone, now);
    let scheduled = [];
    if (publishing) {
      try { scheduled = await (deps.scheduledPosts || scheduledPosts)(c.metricool.connector, { blogId: c.metricool.blogId, from: day || today, to: day || addDays(today, Number(c.daysAhead)), tz: c.timezone }); }
      catch (e) { warn(`studio: could not read Metricool's schedule (${e.message}); filling by the log only`); }
    }
    const slots = openSlots({ config: c, posts, scheduled, now, day }).filter((s) => !only || s.format === only).slice(0, Number(limit || c.maxPerRun));
    if (dryRun) return { slots, retries: retryable(posts, { tz: c.timezone, now }) };
    const results = [];
    // Posts made earlier that never reached Metricool go first.
    if (publishing) for (const p of retryable(posts, { tz: c.timezone, now })) {
      try { results.push(await publishPost(studio, p, { connectors, deps })); }
      catch (e) { results.push(failPublish(studio, p, e)); }
    }
    for (const slot of slots) {
      let record;
      try {
        record = await makePost(studio, slot, { posts: readPosts(studio.paths), connectors, deps });
      } catch (e) {
        studioLog(studio.paths, `FAILED to make ${slot.day} ${slot.time} ${slot.format}: ${e.message}`);
        notify(`${c.client}: post not made`, `${slot.day} ${slot.time}: ${String(e.message).split("\n")[0]}`);
        results.push({ ...slot, status: "failed", why: e.message });
        continue;
      }
      if (!publishing) { results.push(record); continue; }
      try { results.push(await publishPost(studio, record, { connectors, deps })); }
      catch (e) { results.push(failPublish(studio, record, e)); }
    }
    return { slots, made: results };
  } finally {
    release();
  }
}

function failPublish(studio, record, e) {
  const why = String(e.message).split("\n")[0];
  try { fs.writeFileSync(path.join(record.made, "Not posted.txt"), `Not in Metricool yet: ${why}\nThe next daily run tries again while the time is still ahead.\n`); } catch {}
  const next = { ...record, status: "not-posted", why };
  logPost(studio.paths, next);
  studioLog(studio.paths, `NOT POSTED ${record.id}: ${why}`);
  notify(`${studio.config.client}: post not scheduled`, `${record.day} ${record.time}: ${why}`);
  return next;
}

/** One line per result, for the terminal and the log. */
export function dailySummary(result) {
  if (result.skipped) return `nothing done (${result.skipped})`;
  if (!result.made) return result.slots.length ? `open slots: ${result.slots.map((s) => `${s.day} ${s.time} ${s.format}`).join(", ")}` : "every slot is filled";
  if (!result.made.length) return "every slot is filled";
  return result.made.map((r) => `${r.day} ${r.time} ${r.format}: ${r.status}${r.hook ? ` "${r.hook}"` : ""}${r.plannerUrl ? ` ${r.plannerUrl}` : ""}${r.why ? ` (${r.why})` : ""}`).join("\n");
}

