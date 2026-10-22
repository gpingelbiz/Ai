import fs from "node:fs";
import { log, r3, run } from "./util.mjs";

/**
 * Runway developer API (docs.dev.runwayml.com, version 2024-11-06): text to image, image to video, task polling,
 * the organization balance. Plain fetch; every call records what it cost. Credits are $0.01 each.
 */
const BASE = "https://api.dev.runwayml.com";
export const CREDIT_USD = 0.01;

export function hasRunway(env = process.env) {
  return !!(env.RUNWAY_API_KEY || env.RUNWAYML_API_SECRET);
}
function key() {
  const k = process.env.RUNWAY_API_KEY || process.env.RUNWAYML_API_SECRET;
  if (!k) throw new Error("RUNWAY_API_KEY is not set (create one at https://dev.runwayml.com and export it in ~/.zshrc)");
  return k;
}
const headers = () => ({ Authorization: `Bearer ${key()}`, "X-Runway-Version": "2024-11-06", "Content-Type": "application/json" });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function post(path, body, { fetchFn = fetch } = {}) {
  const res = await fetchFn(BASE + path, { method: "POST", headers: headers(), body: JSON.stringify(body) });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    const e = new Error(`runway ${path} ${res.status}: ${text.slice(0, 300)}`);
    e.status = res.status;
    throw e;
  }
  return res.json();
}

/** Poll a task to its end. Runway asks for no more than one check every 5 s. */
export async function waitForTask(id, { fetchFn = fetch, timeoutMs = 600000, sleepFn = sleep, onProgress } = {}) {
  const t0 = Date.now();
  for (;;) {
    await sleepFn(5000 + Math.random() * 2000);
    if (Date.now() - t0 > timeoutMs) throw new Error(`runway task ${id} timed out`);
    const res = await fetchFn(`${BASE}/v1/tasks/${id}`, { headers: headers() });
    if (!res.ok) { await sleepFn(10000); continue; }
    const t = await res.json();
    if (t.status === "SUCCEEDED") return t;
    if (t.status === "FAILED") { const e = new Error(`${t.failureCode || "FAILED"}: ${t.failure || "no reason given"}`); e.code = t.failureCode; e.cost = t.cost?.credits; throw e; }
    if (t.status === "CANCELLED") throw new Error("runway task cancelled");
    if (onProgress && t.status === "RUNNING" && t.progress != null) onProgress(t.progress);
  }
}

/** Text to image. Returns {id, estimatedCredits}. */
export async function createImage({ prompt, ratio = "720:1280", model = "gen4_image", seed, fetchFn } = {}) {
  const body = { model, promptText: String(prompt).slice(0, 1000), ratio, contentModeration: { publicFigureThreshold: "auto" } };
  if (seed != null) body.seed = seed;
  const r = await post("/v1/text_to_image", body, { fetchFn });
  return { id: r.id, estimatedCredits: r.estimatedCost?.credits ?? null };
}

/** Image to video. `image` is an https URL or a data URI. Returns {id, estimatedCredits}. */
export async function createVideo({ image, prompt = "", ratio = "720:1280", duration = 5, model = "gen4_turbo", seed, fetchFn } = {}) {
  const body = { model, promptImage: image, ratio, duration, contentModeration: { publicFigureThreshold: "auto" } };
  if (prompt) body.promptText = String(prompt).slice(0, 1000);
  if (seed != null) body.seed = seed;
  const r = await post("/v1/image_to_video", body, { fetchFn });
  return { id: r.id, estimatedCredits: r.estimatedCost?.credits ?? null };
}

export async function download(url, file, { fetchFn = fetch } = {}) {
  const res = await fetchFn(url);
  if (!res.ok) throw new Error(`download ${res.status}`);
  fs.writeFileSync(file, Buffer.from(await res.arrayBuffer()));
  return file;
}

/** The account: {creditBalance, tier, usage}. */
export async function organization({ fetchFn = fetch } = {}) {
  const res = await fetchFn(`${BASE}/v1/organization`, { headers: headers() });
  if (!res.ok) throw new Error(`runway organization ${res.status}`);
  return res.json();
}

/** Credits spent per day, last 30 days by default: {results:[{date, usedCredits:[{model, amount}]}]}. */
export async function usageByDay({ startDate, beforeDate, fetchFn } = {}) {
  const body = {};
  if (startDate) body.startDate = startDate;
  if (beforeDate) body.beforeDate = beforeDate;
  return post("/v1/organization/usage", body, { fetchFn });
}

/** What a still plus a clip will cost, before asking for it. */
export function estimateClip({ seconds = 5, imageModel = "gen4_image", imageRatio = "720:1280", videoModel = "gen4_turbo" } = {}) {
  const image = imageModel === "gen4_image" ? (/1080/.test(imageRatio) ? 8 : 5) : 5;
  const perSecond = { gen4_turbo: 5, "gen4.5": 12, "veo3.1_fast": 10, grok_imagine_1_5_lite: 3 }[videoModel] ?? 12;
  const credits = image + perSecond * seconds;
  return { image, video: perSecond * seconds, credits, dollars: r3(credits * CREDIT_USD) };
}

/** Make one clip: still, then video from it. Downloads both; returns {png, mp4, items:[usage lines]}. */
/** Runway clips come at 24 fps with a keyframe every 5 s, which makes the renderer's seeks freeze; conform to 30 fps, a keyframe a second. */
export async function conformClip(file, { fps = 30, runFn = run } = {}) {
  const tmp = file.replace(/\.mp4$/, ".conform.mp4");
  await runFn("ffmpeg", ["-y", "-loglevel", "error", "-i", file, "-an", "-c:v", "libx264", "-preset", "fast", "-crf", "17", "-r", String(fps), "-g", String(fps), "-keyint_min", String(fps), "-pix_fmt", "yuv420p", "-movflags", "+faststart", tmp], { quiet: true });
  fs.renameSync(tmp, file);
  return file;
}

export async function makeClip({ scene, motion, dir, name, seconds = 5, ratio = "720:1280", imageRatio = "720:1280", imageModel = "gen4_image", videoModel = "gen4_turbo", fps = 30, fetchFn, sleepFn } = {}) {
  const items = [];
  const png = `${dir}/${name}.png`, mp4 = `${dir}/${name}.mp4`;
  const img = await createImage({ prompt: scene, ratio: imageRatio, model: imageModel, fetchFn });
  let task;
  try {
    task = await waitForTask(img.id, { fetchFn, sleepFn });
  } catch (e) {
    items.push({ service: "runway", model: imageModel, kind: "image", credits: e.cost ?? img.estimatedCredits ?? 0, dollars: r3((e.cost ?? img.estimatedCredits ?? 0) * CREDIT_USD), ok: false, error: e.message });
    throw Object.assign(e, { items });
  }
  items.push({ service: "runway", model: imageModel, kind: "image", credits: task.cost?.credits ?? img.estimatedCredits ?? 0, dollars: r3((task.cost?.credits ?? img.estimatedCredits ?? 0) * CREDIT_USD), ok: true });
  await download(task.output[0], png, { fetchFn });
  const vid = await createVideo({ image: task.output[0], prompt: motion, ratio, duration: seconds, model: videoModel, fetchFn });
  let vtask;
  try {
    vtask = await waitForTask(vid.id, { fetchFn, sleepFn });
  } catch (e) {
    items.push({ service: "runway", model: videoModel, kind: "video", seconds, credits: e.cost ?? vid.estimatedCredits ?? 0, dollars: r3((e.cost ?? vid.estimatedCredits ?? 0) * CREDIT_USD), ok: false, error: e.message });
    throw Object.assign(e, { items, png });
  }
  items.push({ service: "runway", model: videoModel, kind: "video", seconds, credits: vtask.cost?.credits ?? vid.estimatedCredits ?? 0, dollars: r3((vtask.cost?.credits ?? vid.estimatedCredits ?? 0) * CREDIT_USD), ok: true });
  await download(vtask.output[0], mp4, { fetchFn });
  await conformClip(mp4, { fps });
  log(`runway: ${name} ready (${items.reduce((s, i) => s + i.credits, 0)} credits)`);
  return { png, mp4, items };
}
