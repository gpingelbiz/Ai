import fs from "node:fs";
import path from "node:path";
import { codexExec, hasCodex, codexPausedUntil, imageInstructions, savedImage } from "./codex.mjs";
import { loadPreset } from "./presets.mjs";
import { hyperframesBin, renderEnv } from "./render.mjs";
import { voiceFile } from "../scripts/write-caption.mjs";
import { log, warn, readJSON, writeJSON, ensureDir, run, PKG_ROOT } from "./util.mjs";

/**
 * An Instagram carousel from a finished reel: Codex writes the slides from the transcript (cover, one point per
 * slide in the reel's order, a closing line) and draws an image for each, reusing the reel's b-roll stills where
 * they fit. The words are set by the editor in the brand fonts, never drawn by the image model, so they are
 * spelled right. Slides are 1080x1350 (4:5) PNGs rendered by HyperFrames.
 */

export const W = 1080;
export const H = 1350;

export const SLIDES_SCHEMA = {
  type: "object",
  properties: {
    slides: {
      type: "array",
      items: {
        type: "object",
        properties: { title: { type: "string" }, body: { type: "string" }, reuse: { type: "integer" }, scene: { type: "string" }, file: { type: "string" } },
        required: ["title", "body", "reuse", "scene", "file"],
        additionalProperties: false,
      },
    },
  },
  required: ["slides"],
  additionalProperties: false,
};

export function slidesPrompt({ transcript, hook, voice, count, cta, stills, maxNew = 2, style = "" }) {
  return [
    "You turn one talking-head Instagram reel into an Instagram carousel. Do not create or edit any files.",
    `Write exactly ${count} slides.`,
    "- Slide 1, the cover: title of 3 to 8 words that stops the scroll, true to the reel (the hook idea). Body: \"\" or one short line of up to 12 words.",
    `- Slides 2 to ${count - 1}: the reel's points in the order the speaker makes them, one per slide. Title 2 to 6 words. Body 1 or 2 short sentences, at most 28 words, in the speaker's own words wherever possible.`,
    `- Slide ${count}, the close: the punch line or takeaway in at most 10 words. Body: "" or up to 16 words.`,
    "- In every title, wrap the one phrase that matters most in *asterisks* (it is set in gold). One phrase per title, 1 to 3 words.",
    "- No emojis, no hashtags, no invented numbers, results or stories: only what the transcript says.",
    "- When the speaker quotes someone else or acts out a message or line, never present those words as the speaker's own.",
    cta ? `- End the closing slide's body with this call to action, word for word: ${cta}` : "- No call to action anywhere (no comment, DM, follow, share, save or swipe asks).",
    "",
    `Images: a slide can reuse one of the reel's stills by its number (only when it truly fits; each still once), get a new image (at most ${maxNew} new images in the whole carousel, the cover first), or have none (it is set as a bold text card, which looks good). The last slide has none.`,
    "For a reused still: reuse = its number, scene = \"\", file = \"\". For a new image: reuse = 0, scene = one or two sentences describing it, file = slide-<slide number>.png. For none: reuse = 0, scene = \"\", file = \"\".",
    "New scenes: a concrete, literal, cinematic photo of what the slide says (an object, a place, a moment); no clip-art metaphors (lightbulbs, chess pieces, rockets, puzzle pieces, mountains, arrows).",
    `First write the slides, then make the new images. ${imageInstructions({ aspect: "9:16", style })}`,
    stills.length ? ["", "The reel's stills:", ...stills.map((s, k) => `${k + 1}: ${s.scene}`)].join("\n") : "\nThe reel has no stills yet: describe a scene for every slide but the last.",
    "",
    "Voice:",
    voice.trim(),
    "",
    `Hook in the reel: ${hook || "(none)"}`,
    "",
    "Transcript:",
    transcript,
    "",
    'When the images are saved, reply with JSON: {"slides":[{"title":"...","body":"...","reuse":0,"scene":"...","file":"..."}]}',
  ].join("\n");
}

const clean = (s) => String(s || "").replace(/\s+/g, " ").trim();

/**
 * Check and tidy Codex's slides: count, one use per still, no image on the close, a cover that exists, and at
 * most `maxNew` new images (the first ones); any other slide without a still is set as a text card.
 */
export function normalizeSlides(raw, { count, stills = [], hook = "", maxNew = 2 }) {
  let slides = (raw || []).map((s) => ({ title: clean(s.title), body: clean(s.body), reuse: Number.isInteger(s.reuse) ? s.reuse : 0, scene: clean(s.scene) }));
  slides = slides.filter((s) => s.title);
  if (slides.length < 3) throw new Error(`only ${slides.length} usable slides`);
  slides = slides.slice(0, Math.max(3, count));
  if (!slides[0].title && hook) slides[0].title = hook;
  const used = new Set();
  slides.forEach((s, k) => {
    const last = k === slides.length - 1;
    if (last) { s.reuse = 0; s.scene = ""; return; }
    if (s.reuse >= 1 && s.reuse <= stills.length && !used.has(s.reuse)) { used.add(s.reuse); s.scene = ""; }
    else s.reuse = 0;
  });
  let budget = maxNew;
  for (const s of slides) if (!s.reuse && s.scene) { if (budget > 0) budget--; else s.scene = ""; }
  return slides;
}

import { esc } from "./text.mjs";

/** "*10 minutes* after a bad number" -> escaped HTML with the starred phrase in a gold span. */
export function markGold(text) {
  return esc(text).replace(/\*([^*]+)\*/g, '<span class="k">$1</span>').replace(/\*/g, "");
}

/** Starting font size from length; the page shrinks it further if it still does not fit. */
export function titleSize(text, kind) {
  const n = String(text).replace(/\*/g, "").length;
  if (kind === "cover") return n <= 18 ? 132 : n <= 30 ? 116 : n <= 44 ? 100 : 88;
  if (kind === "close") return n <= 22 ? 112 : n <= 40 ? 96 : 84;
  return n <= 16 ? 92 : n <= 28 ? 82 : 72;
}

export function carouselHTML(slides, { colors, handle = "" }) {
  const c = { text: "#FFFFFF", accent: "#FFD600", bg: "#0B0B0D", ...colors };
  const n = slides.length;
  const body = slides
    .map((s, k) => {
      const kind = k === 0 ? "cover" : k === n - 1 ? "close" : "point";
      const img = s.img ? `<img class="bg" src="${esc(s.img)}" alt="" /><div class="shade"></div>` : "";
      const count = kind === "cover" ? "" : `<div class="count">${k + 1}/${n}</div>`;
      const num = kind === "point" ? `<div class="num">${String(k).padStart(2, "0")}</div>` : "";
      const rule = kind !== "point" ? `<div class="rule"></div>` : "";
      const tag = handle ? `<div class="handle">${esc(handle)}</div>` : "";
      return `      <section id="s${k}" class="slide clip ${kind}${s.img ? " has-img" : ""}" data-start="${k}" data-duration="1" data-track-index="0">
        ${img}${count}
        <div class="copy">${num}${kind === "close" ? rule : ""}<h1 class="title fit" data-max="${kind === "cover" ? 600 : kind === "point" && !s.img ? 640 : 520}" style="font-size:${Math.round(titleSize(s.title, kind) * (kind === "point" && !s.img ? 1.2 : 1))}px">${markGold(s.title)}</h1>${kind === "cover" ? rule : ""}${s.body ? `<p class="body fit" data-max="330">${markGold(s.body)}</p>` : ""}</div>
        ${tag}
      </section>`;
    })
    .join("\n");
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=${W}, height=${H}" />
    <title>carousel</title>
    <script src="assets/vendor/gsap.min.js"></script>
    <style>
      @font-face { font-family: "Anton"; src: url("assets/fonts/Anton-Regular.ttf") format("truetype"); font-display: block; }
      @font-face { font-family: "Inter"; src: url("assets/fonts/Inter.ttf") format("truetype"); font-weight: 100 900; font-display: block; }
      html, body { margin: 0; background: ${c.bg}; }
      #root { position: relative; width: ${W}px; height: ${H}px; overflow: hidden; background: ${c.bg}; }
      .slide { position: absolute; inset: 0; overflow: hidden; background: ${c.bg}; color: ${c.text}; font-family: "Inter", sans-serif; }
      .slide .bg { position: absolute; left: 0; top: 0; width: 100%; height: 100%; object-fit: cover; }
      .slide .shade { position: absolute; inset: 0; }
      .cover .shade { background: linear-gradient(180deg, rgba(0,0,0,0.05) 0%, rgba(0,0,0,0) 30%, ${c.bg}d9 66%, ${c.bg} 100%); }
      .point .bg { height: 58%; }
      .point .shade { background: linear-gradient(180deg, rgba(0,0,0,0.25) 0%, rgba(0,0,0,0) 22%, rgba(0,0,0,0) 34%, ${c.bg} 58%, ${c.bg} 100%); }
      .copy { position: absolute; left: 84px; right: 84px; bottom: 150px; display: flex; flex-direction: column; gap: 30px; }
      .point:not(.has-img) .copy { top: 0; bottom: 0; justify-content: center; }
      .close .copy { top: 0; bottom: 0; justify-content: center; text-align: center; align-items: center; }
      .title { margin: 0; font-family: "Anton", sans-serif; font-weight: 400; line-height: 1.02; letter-spacing: 0.005em; text-transform: uppercase; text-wrap: balance; }
      .cover .title { text-shadow: 0 0.04em 0.4em rgba(0,0,0,0.55); }
      .title .k { color: ${c.accent}; }
      .body { margin: 0; font-size: 40px; line-height: 1.32; font-weight: 500; color: ${c.text}; opacity: 0.88; text-wrap: pretty; }
      .body .k { color: ${c.accent}; }
      .cover .body { font-size: 38px; }
      .close .body { max-width: 820px; }
      .num { font-family: "Anton", sans-serif; font-size: 56px; line-height: 1; color: ${c.accent}; }
      .rule { width: 132px; height: 10px; border-radius: 5px; background: ${c.accent}; }
      .count { position: absolute; top: 54px; right: 64px; font-size: 28px; font-weight: 600; letter-spacing: 0.06em; color: ${c.text}; opacity: 0.8; text-shadow: 0 2px 10px rgba(0,0,0,0.6); }
      .handle { position: absolute; left: 84px; bottom: 64px; font-size: 28px; font-weight: 600; letter-spacing: 0.02em; color: ${c.text}; opacity: 0.62; }
      .close .handle { left: 0; right: 0; text-align: center; }
    </style>
  </head>
  <body>
    <div id="root" data-composition-id="carousel" data-start="0" data-width="${W}" data-height="${H}" data-duration="${n}" data-fps="30">
${body}
    </div>
    <script>
      // Shrink a title or body taller than its data-max (or with a word wider than the column), 4% at a time.
      // Measures the line boxes, not the ink: Anton's tall caps overflow a tight line-height by design.
      function fit() {
        document.querySelectorAll(".fit").forEach((el) => {
          const max = parseFloat(el.dataset.max) || 520;
          let size = parseFloat(getComputedStyle(el).fontSize);
          for (let i = 0; i < 30 && (el.offsetHeight > max || el.scrollWidth > el.clientWidth + 2); i++) { size *= 0.96; el.style.fontSize = size + "px"; }
        });
      }
      fit();
      if (document.fonts) document.fonts.ready.then(fit);
      window.__timelines = window.__timelines || {};
      window.__timelines["carousel"] = gsap.timeline({ paused: true });
    </script>
  </body>
</html>
`;
}

/** Render each slide to a PNG with `hyperframes snapshot` (one 1-second scene per slide). */
async function snapshotSlides(projectDir, count, outDir) {
  const bin = hyperframesBin();
  const shots = ensureDir(path.join(projectDir, "shots"));
  for (const f of fs.readdirSync(shots)) fs.rmSync(path.join(shots, f), { force: true });
  const at = Array.from({ length: count }, (_, k) => `${k + 0.5}`).join(",");
  await run(bin[0], [...bin.slice(1), "snapshot", projectDir, "--at", at, "--no-end", "--keep", "-o", shots, "--describe", "false"], { capture: true, env: renderEnv() });
  ensureDir(outDir);
  const files = [];
  for (let k = 0; k < count; k++) {
    const src = path.join(shots, `at-${k + 0.5}s.png`);
    if (!fs.existsSync(src)) throw new Error(`snapshot did not write slide ${k + 1}`);
    const dst = path.join(outDir, `Slide ${k + 1}.png`);
    fs.copyFileSync(src, dst);
    files.push(dst);
  }
  return files;
}

export function carouselText(slides, { hook }) {
  const lines = [`CAROUSEL: ${String(hook || slides[0].title).replace(/\*/g, "")}`, `${slides.length} slides, 1080x1350. Post them in order. Same caption as the reel works.`, ""];
  slides.forEach((s, k) => {
    lines.push(`SLIDE ${k + 1}`, s.title.replace(/\*/g, ""));
    if (s.body) lines.push(s.body.replace(/\*/g, ""));
    lines.push("");
  });
  return lines.join("\n");
}

/**
 * Make the carousel for a finished reel's work dir. Writes <workDir>/carousel/ (slides.json, images, project)
 * and the PNGs plus carousel.txt into `out` (default <workDir>/carousel/slides). Returns the PNG paths.
 */
export async function makeCarousel(workDir, { out, force = false, slides: count, images } = {}) {
  workDir = path.resolve(workDir);
  const plan = readJSON(path.join(workDir, "plan.json"));
  const preset = plan.style?.name ? safePreset(plan.style.name) : null;
  const settings = { ...(preset?.carousel || {}), ...(plan.style?.carousel || {}) };
  count = Math.max(4, Math.min(8, parseInt(count || settings.slides || 6, 10)));
  const dir = ensureDir(path.join(workDir, "carousel"));
  out = path.resolve(out || path.join(dir, "slides"));
  const transcript = (plan.captions || []).map((g) => g.text).join(" ").replace(/\s+/g, " ").trim();
  if (!transcript) throw new Error("this reel has no transcript to build slides from");
  if (!hasCodex()) throw new Error("the carousel needs the Codex CLI (codex) signed in");
  const hook = plan.hook?.text || "";
  const brollPath = path.join(workDir, "broll", "broll.json");
  const stills = fs.existsSync(brollPath) ? (readJSON(brollPath).shots || []).filter((s) => s.file && fs.existsSync(s.file)) : [];

  const slidesPath = path.join(dir, "slides.json");
  // One Codex session writes the slides and draws the new images into images/ (files slide-<n>.png).
  const imgDir = ensureDir(path.join(dir, "images"));
  const maxNew = Math.max(0, Math.min(6, parseInt(images ?? settings.newImages ?? 2, 10)));
  let slides;
  if (!force && fs.existsSync(slidesPath) && readJSON(slidesPath).transcript === transcript) {
    slides = readJSON(slidesPath).slides;
    log(`carousel: reusing the slides in ${slidesPath}`);
  } else {
    if (codexPausedUntil()) throw new Error(`Codex is paused after a rate limit until ${new Date(codexPausedUntil()).toLocaleTimeString()}`);
    for (const f of fs.readdirSync(imgDir)) fs.rmSync(path.join(imgDir, f), { force: true });
    const t0 = Date.now();
    log(`carousel: Codex is writing ${count} slides and drawing up to ${maxNew} new image${maxNew === 1 ? "" : "s"}…`);
    const cta = process.env.REEL_WATCH_CTA || "";
    const prompt = slidesPrompt({ transcript, hook, voice: fs.readFileSync(voiceFile(plan), "utf8"), count, cta, stills, maxNew, style: settings.style || "" });
    const reply = await codexExec(prompt, { cwd: imgDir, schema: SLIDES_SCHEMA, timeoutMs: 600000 });
    slides = normalizeSlides(JSON.parse(reply).slides, { count, stills, hook, maxNew });
    writeJSON(slidesPath, { transcript, slides });
    log(`carousel: Codex done in ${Math.round((Date.now() - t0) / 1000)}s`);
  }

  const projectDir = ensureDir(path.join(dir, "project"));
  ensureDir(path.join(projectDir, "assets", "fonts"));
  ensureDir(path.join(projectDir, "assets", "vendor"));
  ensureDir(path.join(projectDir, "assets", "img"));
  for (const f of ["Anton-Regular.ttf", "Inter.ttf"]) fs.copyFileSync(path.join(PKG_ROOT, "assets", "fonts", f), path.join(projectDir, "assets", "fonts", f));
  fs.copyFileSync(path.join(PKG_ROOT, "assets", "vendor", "gsap.min.js"), path.join(projectDir, "assets", "vendor", "gsap.min.js"));
  const placed = slides.map((s, k) => {
    const file = s.reuse ? stills[s.reuse - 1]?.file : s.scene ? savedImage(imgDir, `slide-${k + 1}.png`) : null;
    if (!file || !fs.existsSync(file)) return { ...s, img: null };
    const rel = `assets/img/slide-${k + 1}${path.extname(file)}`;
    fs.copyFileSync(file, path.join(projectDir, rel));
    return { ...s, img: rel };
  });
  fs.writeFileSync(path.join(projectDir, "index.html"), carouselHTML(placed, { colors: plan.style?.colors, handle: settings.handle || "" }));
  log("carousel: rendering slides…");
  const files = await snapshotSlides(projectDir, placed.length, out);
  fs.writeFileSync(path.join(out, "carousel.txt"), carouselText(slides, { hook }));
  log(`carousel: ${files.length} slides in ${out}`);
  return files;
}

function safePreset(name) {
  try { return loadPreset(name); } catch { return null; }
}
