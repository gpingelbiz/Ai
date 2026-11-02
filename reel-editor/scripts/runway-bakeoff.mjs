import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { parseArgs } from "node:util";
import { makeStill, animateStill, makeSound, estimateClip, modelInfo, dataURI } from "../src/runway.mjs";
import { stillPrompt, videoMotion, shotSeed } from "../src/broll-runway.mjs";
import { recordUsage, reelUsageNote } from "../src/usage.mjs";
import { ensureDir, readJSON, writeJSON, run, warn, log } from "../src/util.mjs";

export function bakeoffOptions(args) {
  const { values } = parseArgs({ args, options: {
    picks: { type: "string" }, out: { type: "string" }, stage: { type: "string" },
    images: { type: "string", default: "gen4_image,nano_banana_2.1" },
    still: { type: "string", default: "gen4_image" },
    videos: { type: "string", default: "gen4_turbo,kling3.0_standard,grok_imagine_1_5_lite" },
    seconds: { type: "string", default: "3" }, "max-credits": { type: "string" },
    "last-frame": { type: "boolean", default: false }, sfx: { type: "boolean", default: false },
  } });
  if (!values.picks || !values.out || !["stills", "videos"].includes(values.stage)) throw new Error("Use --picks <json> --out <dir> --stage stills|videos [--max-credits N]");
  const seconds = Number(values.seconds), maxCredits = values["max-credits"] == null ? Infinity : Number(values["max-credits"]);
  if (!Number.isInteger(seconds) || seconds < 1 || (!Number.isFinite(maxCredits) && maxCredits !== Infinity) || maxCredits < 0) throw new Error("Invalid seconds or max-credits");
  const images = values.images.split(","), videos = values.videos.split(",");
  images.forEach((m) => modelInfo(m, "image"));
  modelInfo(values.still, "image");
  videos.forEach((m) => estimateClip({ seconds, videoModel: m }));
  return { picks: values.picks, out: path.resolve(values.out), stage: values.stage, images, still: values.still, videos, seconds, maxCredits, lastFrame: values["last-frame"], sfx: values.sfx };
}

/** A grid keeps model order stable; filenames and usage.json identify each row. */
export async function bakeoffSheet(files, file, columns, { runFn = run } = {}) {
  if (!files.length) return;
  const layout = files.map((_, i) => `${i % columns * 180}_${Math.floor(i / columns) * 320}`).join("|");
  const filters = files.map((_, i) => `[${i}:v]scale=180:320:force_original_aspect_ratio=increase,crop=180:320,setsar=1[v${i}]`);
  filters.push(files.length === 1 ? "[v0]null[out]" : `${files.map((_, i) => `[v${i}]`).join("")}xstack=inputs=${files.length}:layout=${layout}[out]`);
  await runFn("ffmpeg", ["-y", "-loglevel", "error", ...files.flatMap((f) => ["-i", f]), "-filter_complex", filters.join(";"), "-map", "[out]", "-frames:v", "1", file], { quiet: true });
}

/** Independent comparison runner: no edit pipeline, and every purchase is checked and recorded. */
export async function runBakeoff(options, deps = {}) {
  const { out, stage, images, videos, still, seconds, lastFrame, sfx, maxCredits = Infinity } = options;
  const input = readJSON(options.picks), picks = Array.isArray(input) ? input : input.picks;
  if (!Array.isArray(picks) || !picks.length) throw new Error("The picks file must contain a nonempty array or {picks:[]}");
  const names = picks.map((p, i) => String(p.name || `shot-${i + 1}`).replace(/[^a-zA-Z0-9_-]+/g, "-").replace(/^-+|-+$/g, "") || `shot-${i + 1}`);
  if (new Set(names).size !== names.length) throw new Error("Pick names must be unique");
  const imageModels = stage === "stills" ? images : [still];
  imageModels.forEach((m) => modelInfo(m, "image"));
  if (stage === "videos") videos.forEach((m) => estimateClip({ seconds, imageModel: still, videoModel: m }));
  ensureDir(out);
  const usagePath = path.join(out, "usage.json");
  const previous = fs.existsSync(usagePath) ? readJSON(usagePath).items || [] : [];
  const items = [], io = { fetchFn: deps.fetchFn, sleepFn: deps.sleepFn, runFn: deps.runFn || run };
  const spent = () => [...previous, ...items].reduce((sum, i) => sum + i.credits, 0);
  const before = (credits) => { if (spent() + credits > maxCredits) throw Object.assign(new Error(`Credit cap ${maxCredits} reached before purchase (${credits} more credits)`), { code: "BUDGET" }); };
  let aborted = false;
  const save = () => writeJSON(usagePath, { items: [...previous, ...items], credits: spent(), aborted });
  // Helpers retain charged task lines when a later download or local process fails.
  const buy = async (fn) => {
    try { const result = await fn(); items.push(...result.items); return result; }
    catch (e) { if (e.items) items.push(...e.items); throw e; }
    finally { save(); }
  };
  try {
    for (let i = 0; i < picks.length; i++) {
      const pick = picks[i], dir = ensureDir(path.join(out, names[i])), seed = shotSeed(out, pick.line ?? i);
      if (stage === "stills") {
        const sheet = [];
        for (const imageModel of images) {
          const cost = estimateClip({ seconds: 3, imageModel }).image;
          const file = path.join(dir, `${imageModel}.png`);
          before(cost);
          const first = await buy(() => makeStill({ prompt: stillPrompt(pick), file, imageModel, seed, ...io }));
          // Make the extension truthful even when a provider returns WebP or JPEG.
          await io.runFn("ffmpeg", ["-y", "-loglevel", "error", "-i", first.jpg, "-frames:v", "1", file], { quiet: true });
          sheet.push(file);
          if (pick.endScene) {
            before(cost);
            const end = path.join(dir, `${imageModel}.end.png`);
            const result = await buy(() => makeStill({ prompt: `The same subject and setting as @firstframe. ${stillPrompt({ scene: pick.endScene })}`, file: end, imageModel, seed, referenceImages: [{ uri: dataURI(first.jpg, "image/jpeg"), tag: "firstframe" }], ...io }));
            await io.runFn("ffmpeg", ["-y", "-loglevel", "error", "-i", result.jpg, "-frames:v", "1", end], { quiet: true });
            sheet.push(end);
          }
        }
        await bakeoffSheet(sheet, path.join(dir, "stills-sheet.png"), pick.endScene ? 2 : images.length, io);
      } else {
        const png = path.join(dir, `${still}.png`), end = path.join(dir, `${still}.end.png`);
        if (!fs.existsSync(png)) throw new Error(`Run the stills stage first: ${png}`);
        const frames = [];
        for (const videoModel of videos) {
          const useLast = lastFrame && modelInfo(videoModel, "video").fields.lastFrame && fs.existsSync(end);
          const mp4 = path.join(dir, `${still}--${videoModel}.mp4`);
          const cost = estimateClip({ seconds, imageModel: still, videoModel }).video;
          await buy(() => animateStill({ png, last: useLast ? end : undefined, mp4, motion: videoMotion(pick), seconds, videoModel, seed, audio: false, beforeBuy: () => before(cost), ...io }));
          if (sfx && pick.sound) {
            try {
              await buy(() => makeSound({ file: mp4, out: mp4.replace(/\.mp4$/, ".sfx.wav"), sound: pick.sound, seconds, seed, beforeBuy: () => before(seconds * modelInfo("mirelo_sfx_2_0", "audio").credits.perSecond), ...io }));
            } catch (e) { if (e.code === "BUDGET") throw e; warn(`bake-off: sound failed (${e.message})`); }
          }
          for (const time of [0, 0.75, 1.5, 2.25]) {
            const frame = mp4.replace(/\.mp4$/, `.${time}.png`);
            await io.runFn("ffmpeg", ["-y", "-loglevel", "error", "-ss", String(Math.min(time, seconds - 1 / 30)), "-i", mp4, "-frames:v", "1", frame], { quiet: true });
            frames.push(frame);
          }
        }
        await bakeoffSheet(frames, path.join(dir, `${still}--frames-sheet.png`), 4, io);
      }
    }
  } catch (e) {
    if (e.code !== "BUDGET") throw e;
    aborted = true;
    warn(`bake-off: ${e.message}; stopped cleanly`);
  } finally {
    save();
    (deps.recordUsage || recordUsage)({ reel: path.basename(out), items });
    fs.writeFileSync(path.join(out, "runway usage.txt"), reelUsageNote([...previous, ...items]));
  }
  log(`bake-off: ${spent()} credits, ${aborted ? "cap reached" : "ready"}`);
  return { items, credits: spent(), aborted };
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  try { await runBakeoff(bakeoffOptions(process.argv.slice(2))); }
  catch (e) { warn(e.message); process.exitCode = 1; }
}
