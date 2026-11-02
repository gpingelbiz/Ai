import fs from "node:fs";
import { log, warn, r3, run } from "./util.mjs";

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

/** Drop only the optional finish, then refuse an oversized prompt before any paid call. */
export function fitPrompt(prompt, { optionalStyle = "", warnFn = warn } = {}) {
  let text = String(prompt);
  if (text.length <= 1000) return text;
  if (optionalStyle && text.endsWith(optionalStyle)) {
    text = text.slice(0, -optionalStyle.length).trimEnd();
    warnFn("runway: prompt exceeded 1,000 UTF-16 units; dropped the optional style sentence");
  }
  if (text.length > 1000) {
    warnFn(`runway: prompt is ${text.length} UTF-16 units; shorten complete sentences before generation`);
    throw new Error("Runway prompt exceeds 1,000 UTF-16 units");
  }
  return text;
}

/** Model capabilities and prices from the developer API schema; credits are per output. */
export const MODELS = {
  gen4_image: { kind: "image", credits: { "720p": 5, "1080p": 8 }, vertical: "720:1280", sizes: { "720p": "720:1280", "1080p": "1080:1920" }, fields: { seed: true, contentModeration: true, references: 3 } },
  "nano_banana_2.1": { kind: "image", credits: { "1K": 4, "2K": 6 }, vertical: "768:1376", ratioAliases: { "720:1280": "768:1376" }, sizes: { "1K": "768:1376", "2K": "1536:2752" }, fields: { references: 14 } },
  gen4_turbo: { kind: "video", credits: { perSecond: 5 }, duration: [2, 10], vertical: "720:1280", fields: { seed: true, contentModeration: true } },
  "gen4.5": { kind: "video", credits: { perSecond: 12 }, duration: [2, 10], vertical: "720:1280", requiredPrompt: true, fields: { seed: true, contentModeration: true } },
  "kling3.0_standard": { kind: "video", credits: { perSecond: 9, audioSurcharge: 4 }, duration: [3, 15], vertical: "720:1280", fields: { audio: true, lastFrame: true } },
  grok_imagine_1_5_lite: { kind: "video", credits: { perSecond: 3, perStartFrame: 1 }, duration: [1, 15], vertical: "auto_720p", fields: {} },
  "gemini_omni_flash_1.1": { kind: "video", credits: { perSecond: 10 }, duration: [3, 10], vertical: "720:1280", requiredPrompt: true, fields: { lastFrame: true } },
  wan3: { kind: "video", credits: { perSecond: 10 }, duration: [2, 30], vertical: "auto_720p", requiredPrompt: true, fields: { audio: true, lastFrame: true } },
  mirelo_sfx_2_0: { kind: "audio", credits: { perSecond: 2 }, duration: [1, 600], vertical: null, fields: { seed: true } },
};

export function modelInfo(model, kind) {
  const info = Object.hasOwn(MODELS, model) ? MODELS[model] : null;
  if (!info || (kind && info.kind !== kind)) throw new Error(`Unknown Runway ${kind || ""} model: ${model}`);
  return info;
}

function imageResolution(info, { ratio, size } = {}) {
  ratio = info.ratioAliases?.[ratio] || ratio || (size ? info.sizes[size] : info.vertical);
  const matched = Object.keys(info.sizes).find((s) => info.sizes[s] === ratio);
  if (!matched) throw new Error(`Unsupported Runway image size/ratio: ${size || ratio}`);
  return { ratio, credits: info.credits[matched] };
}

function durationFor(info, duration) {
  if (!Number.isFinite(duration) || duration < info.duration[0] || duration > info.duration[1] || (info.kind === "video" && !Number.isInteger(duration))) {
    throw new Error(`Runway duration must be ${info.duration[0]}–${info.duration[1]} seconds${info.kind === "video" ? " (integer)" : ""}`);
  }
  return duration;
}

function optionalFields(body, info, { seed } = {}) {
  if (info.fields.seed && seed != null) {
    if (!Number.isInteger(seed) || seed < 0 || seed > 4294967295) throw new Error("Runway seed must be an unsigned 32-bit integer");
    body.seed = seed;
  }
  if (info.fields.contentModeration) body.contentModeration = { publicFigureThreshold: "auto" };
  return body;
}
const created = (r) => ({ id: r.id, estimatedCredits: r.estimatedCost?.credits ?? null });

/** Text to image, with only fields accepted by that model. */
export async function createImage({ prompt, ratio, size, model = "gen4_image", seed, referenceImages, fetchFn } = {}) {
  const info = modelInfo(model, "image");
  ratio = imageResolution(info, { ratio, size }).ratio;
  const body = optionalFields({ model, promptText: fitPrompt(prompt), ratio }, info, { seed });
  if (referenceImages?.length) {
    if (referenceImages.length > info.fields.references) throw new Error(`${model} accepts up to ${info.fields.references} reference images`);
    body.referenceImages = referenceImages.map(({ uri, tag }) => ({ uri, ...(tag ? { tag } : {}) }));
  }
  return created(await post("/v1/text_to_image", body, { fetchFn }));
}

/** Image to video. Explicitly disable native sound unless requested. */
export async function createVideo({ image, lastImage, prompt = "", duration = 5, model = "gen4_turbo", seed, audio = false, fetchFn } = {}) {
  const info = modelInfo(model, "video");
  const promptImage = lastImage && info.fields.lastFrame ? [{ uri: image, position: "first" }, { uri: lastImage, position: "last" }] : image;
  const body = optionalFields({ model, promptImage, ratio: info.vertical, duration: durationFor(info, duration) }, info, { seed });
  if (prompt || info.requiredPrompt) body.promptText = fitPrompt(prompt || "Locked camera.");
  if (info.fields.audio) body.audio = !!audio;
  return created(await post("/v1/image_to_video", body, { fetchFn }));
}

export async function createSound({ videoUri, promptText, negativePrompt = "music, speech, singing", duration, seed, format = "wav", numVariants = 1, model = "mirelo_sfx_2_0", fetchFn } = {}) {
  const info = modelInfo(model, "audio");
  if (videoUri?.startsWith("data:") && videoUri.length > 5 * 1024 * 1024) throw new Error("Runway sound video data URI exceeds 5 MB");
  if (!["mp3", "wav", "flac"].includes(format) || !Number.isInteger(numVariants) || numVariants < 1 || numVariants > 4) throw new Error("Invalid Runway sound format or variant count");
  const body = optionalFields({ model, videoUri, duration: durationFor(info, duration), format, numVariants }, info, { seed });
  if (promptText) body.promptText = promptText;
  if (negativePrompt) body.negativePrompt = negativePrompt;
  return created(await post("/v1/video_to_audio", body, { fetchFn }));
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

/** Price the complete shot before buying any part of it. */
export function estimateClip({ seconds = 5, imageModel = "gen4_image", imageRatio, imageSize, videoModel = "gen4_turbo", audio = false, lastFrame = false, sfxSeconds = 0 } = {}) {
  const im = modelInfo(imageModel, "image"), vm = modelInfo(videoModel, "video");
  const image = imageResolution(im, { ratio: imageRatio, size: imageSize }).credits;
  durationFor(vm, seconds);
  const video = (vm.credits.perSecond + (audio && vm.fields.audio ? vm.credits.audioSurcharge || 0 : 0)) * seconds + (vm.credits.perStartFrame || 0);
  const endImage = lastFrame && vm.fields.lastFrame ? image : 0;
  const sound = sfxSeconds ? durationFor(MODELS.mirelo_sfx_2_0, sfxSeconds) * MODELS.mirelo_sfx_2_0.credits.perSecond : 0;
  const credits = r3(image + endImage + video + sound);
  return { image, video, ...(endImage ? { endImage } : {}), ...(sound ? { sound } : {}), credits, dollars: r3(credits * CREDIT_USD) };
}

/** Keep every charged task, including failed generations, attached to errors for the caller's ledger. */
export async function generateTask({ kind, model, credits, seconds, request, items, fetchFn, sleepFn }) {
  const started = await request();
  let task;
  try { task = await waitForTask(started.id, { fetchFn, sleepFn }); }
  catch (e) {
    const cost = e.cost ?? started.estimatedCredits ?? credits;
    items.push({ service: "runway", model, kind, ...(seconds != null ? { seconds } : {}), credits: cost, dollars: r3(cost * CREDIT_USD), ok: false, error: e.message });
    throw Object.assign(e, { items });
  }
  const cost = task.cost?.credits ?? started.estimatedCredits ?? credits;
  items.push({ service: "runway", model, kind, ...(seconds != null ? { seconds } : {}), credits: cost, dollars: r3(cost * CREDIT_USD), ok: true });
  return task;
}

export const dataURI = (file, mime) => `data:${mime};base64,${fs.readFileSync(file).toString("base64")}`;

/** Every video model receives the same portrait JPEG, including stills from a different aspect ratio. */
export async function conformStill(file, { runFn = run } = {}) {
  const jpg = file.replace(/\.[^.]+$/, ".input.jpg");
  for (const quality of [2, 5, 10, 18, 26, 31]) {
    await runFn("ffmpeg", ["-y", "-loglevel", "error", "-i", file, "-frames:v", "1", "-vf", "scale=720:1280:force_original_aspect_ratio=increase,crop=720:1280", "-q:v", String(quality), jpg], { quiet: true });
    if (fs.statSync(jpg).size < 2 * 1000 * 1000) return jpg;
  }
  throw new Error("Runway still JPEG exceeds 2 MB");
}

export async function makeStill({ prompt, file, imageModel = "gen4_image", imageRatio, seed, referenceImages, items = [], fetchFn, sleepFn, runFn } = {}) {
  const info = modelInfo(imageModel, "image");
  const resolution = imageResolution(info, { ratio: imageRatio });
  try {
    const task = await generateTask({ kind: "image", model: imageModel, credits: resolution.credits, request: () => createImage({ prompt, model: imageModel, ratio: imageRatio, seed, referenceImages, fetchFn }), items, fetchFn, sleepFn });
    await download(task.output[0], file, { fetchFn });
    return { png: file, jpg: await conformStill(file, { runFn }), items };
  } catch (e) { throw Object.assign(e, { items }); }
}

/** Animate an approved still, reusing its seed and optional approved end frame. */
export async function animateStill({ png, last, mp4, motion, seconds = 5, videoModel = "gen4_turbo", seed, audio = false, fps = 30, fetchFn, sleepFn, runFn, beforeBuy, items = [] } = {}) {
  const estimate = estimateClip({ seconds, videoModel, audio }).video;
  try {
    const jpg = await conformStill(png, { runFn });
    const end = last ? await conformStill(last, { runFn }) : null;
    if (beforeBuy) await beforeBuy("video", items);
    const task = await generateTask({ kind: "video", model: videoModel, seconds, credits: estimate, request: () => createVideo({ image: dataURI(jpg, "image/jpeg"), lastImage: end ? dataURI(end, "image/jpeg") : undefined, prompt: motion, duration: seconds, model: videoModel, seed, audio, fetchFn }), items, fetchFn, sleepFn });
    await download(task.output[0], mp4, { fetchFn });
    await conformClip(mp4, { fps, runFn });
    return { mp4, items, last };
  } catch (e) { throw Object.assign(e, { items, png, last }); }
}

/** Small local proxy keeps even high-bitrate trimmed clips within Mirelo's 5 MB data URI limit. */
export async function makeSound({ file, out, sound, seconds, seed, fetchFn, sleepFn, runFn = run, beforeBuy } = {}) {
  const items = [], proxy = file.replace(/\.mp4$/, ".sound.mp4");
  try {
    await runFn("ffmpeg", ["-y", "-loglevel", "error", "-i", file, "-t", String(seconds), "-an", "-vf", "scale=360:640", "-c:v", "libx264", "-b:v", "400k", "-maxrate", "500k", "-bufsize", "1000k", "-movflags", "+faststart", proxy], { quiet: true });
    const videoUri = dataURI(proxy, "video/mp4");
    if (videoUri.length > 5 * 1024 * 1024) throw new Error("Runway sound video data URI exceeds 5 MB");
    if (beforeBuy) await beforeBuy("sound", items);
    const task = await generateTask({ kind: "audio", model: "mirelo_sfx_2_0", seconds, credits: seconds * MODELS.mirelo_sfx_2_0.credits.perSecond, request: () => createSound({ videoUri, promptText: sound, duration: seconds, seed, format: "wav", fetchFn }), items, fetchFn, sleepFn });
    await download(task.output[0], out, { fetchFn });
    return { sfx: out, items };
  } catch (e) { throw Object.assign(e, { items }); }
  finally { fs.rmSync(proxy, { force: true }); }
}

/** Runway clips come at 24 fps with a keyframe every 5 s, which makes the renderer's seeks freeze; conform to 30 fps, a keyframe a second. */
export async function conformClip(file, { fps = 30, runFn = run } = {}) {
  const tmp = file.replace(/\.mp4$/, ".conform.mp4");
  await runFn("ffmpeg", ["-y", "-loglevel", "error", "-i", file, "-an", "-c:v", "libx264", "-preset", "fast", "-crf", "17", "-r", String(fps), "-g", String(fps), "-keyint_min", String(fps), "-pix_fmt", "yuv420p", "-movflags", "+faststart", tmp], { quiet: true });
  fs.renameSync(tmp, file);
  return file;
}

export async function makeClip({ scene, endScene, motion, dir, name, seconds = 5, imageRatio, imageModel = "gen4_image", videoModel = "gen4_turbo", seed, audio = false, fps = 30, fetchFn, sleepFn, runFn, check, beforeBuy } = {}) {
  estimateClip({ seconds, imageModel, imageRatio, videoModel, audio, lastFrame: !!endScene });
  const items = [], png = `${dir}/${name}.png`, mp4 = `${dir}/${name}.mp4`;
  let last;
  try {
    if (beforeBuy) await beforeBuy("image", items);
    const first = await makeStill({ prompt: scene, file: png, imageModel, imageRatio, seed, items, fetchFn, sleepFn, runFn });
    const result = check ? await check(first.jpg) : null;
    if (result?.ok === false) throw Object.assign(new Error(result.why || "still check failed"), { code: result.unavailable ? "CHECK_UNAVAILABLE" : "CHECK" });
    if (endScene && modelInfo(videoModel, "video").fields.lastFrame) {
      try {
        if (beforeBuy) await beforeBuy("endImage", items);
        const end = await makeStill({ prompt: fitPrompt(`The same subject and setting as @firstframe. ${endScene}`), file: `${dir}/${name}.end.png`, imageModel, imageRatio, seed, referenceImages: [{ uri: dataURI(first.jpg, "image/jpeg"), tag: "firstframe" }], items, fetchFn, sleepFn, runFn });
        const checked = check ? await check(end.jpg, { end: true, first: first.jpg }) : null;
        if (checked?.ok !== false) last = end.png;
        else warn(`runway: end still rejected (${checked.why}); using first frame only`);
      } catch (e) { warn(`runway: end still unavailable (${e.message}); using first frame only`); }
    }
    await animateStill({ png, last, mp4, motion, seconds, videoModel, seed, audio, fps, fetchFn, sleepFn, runFn, beforeBuy, items });
    log(`runway: ${name} ready (${items.reduce((s, i) => s + i.credits, 0)} credits)`);
    return { png, mp4, last, items };
  } catch (e) { throw Object.assign(e, { items, png, last }); }
}
