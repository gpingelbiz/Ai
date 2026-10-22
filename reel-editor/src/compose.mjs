import fs from "node:fs";
import path from "node:path";
import { ensureDir, copyOrLink, r3, PKG_ROOT } from "./util.mjs";
import { sceneHTML, graphicsCSS, GRAPHICS_JS } from "./graphics.mjs";

export function canvasFor(mode, meta) {
  const m = mode === "auto" || !mode ? (meta.height > meta.width ? "portrait" : meta.width > meta.height ? "landscape" : "square") : mode;
  if (m === "portrait") return { width: 1080, height: 1920, mode: m };
  if (m === "landscape") return { width: 1920, height: 1080, mode: m };
  if (m === "square") return { width: 1080, height: 1080, mode: m };
  if (m === "source") {
    const long = Math.max(meta.width, meta.height);
    const s = Math.min(1, 1920 / long);
    const even = (n) => Math.max(2, Math.round((n * s) / 2) * 2);
    return { width: even(meta.width), height: even(meta.height), mode: m };
  }
  throw new Error(`unknown canvas: ${mode}`);
}

function hexA(hex, a) {
  const m = /^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex);
  if (!m) return hex;
  return `rgba(${parseInt(m[1], 16)}, ${parseInt(m[2], 16)}, ${parseInt(m[3], 16)}, ${a})`;
}

import { esc } from "./text.mjs";

function fadePoints(t) {
  const v = t.volume ?? 1;
  const d = t.duration;
  const fi = Math.min(t.fadeIn || 0, d / 2);
  const fo = Math.min(t.fadeOut || 0, d / 2);
  const pts = [];
  pts.push({ t: 0, v: fi ? 0 : v });
  if (fi) pts.push({ t: r3(fi), v });
  if (fo) pts.push({ t: r3(d - fo), v });
  pts.push({ t: r3(d), v: fo ? 0 : v });
  return pts;
}

/** Write the HyperFrames project (index.html + assets) from a plan.json. Re-runnable after plan edits. */
export function composeProject(plan, projectDir) {
  const assets = ensureDir(path.join(projectDir, "assets"));
  ensureDir(path.join(assets, "fonts"));
  ensureDir(path.join(assets, "vendor"));
  for (const f of ["Anton-Regular.ttf", "Inter.ttf"]) fs.copyFileSync(path.join(PKG_ROOT, "assets", "fonts", f), path.join(assets, "fonts", f));
  fs.copyFileSync(path.join(PKG_ROOT, "assets", "vendor", "gsap.min.js"), path.join(assets, "vendor", "gsap.min.js"));
  const sfxUsed = new Set((plan.audio?.tracks || []).map((t) => t.src).filter((s) => s.startsWith("assets/sfx/")));
  if (sfxUsed.size) ensureDir(path.join(assets, "sfx"));
  for (const s of sfxUsed) fs.copyFileSync(path.join(PKG_ROOT, s), path.join(projectDir, s));
  const ext = path.extname(plan.video.src) || ".mp4";
  const footage = `assets/footage${ext}`;
  copyOrLink(plan.video.src, path.join(projectDir, footage));
  (plan.broll || []).forEach((b, i) => {
    b.src = `assets/broll/broll-${i + 1}${path.extname(b.file) || ".png"}`;
    b.video = /\.(mp4|mov|webm|m4v)$/i.test(b.file || "");
    copyOrLink(b.file, path.join(projectDir, b.src));
  });
  // The cold open is a still: the first b-roll image, or a generated clip's own still frame.
  if (plan.coldOpen && plan.broll?.[0]) {
    const b = plan.broll[0];
    if (b.video && b.still && fs.existsSync(b.still)) { copyOrLink(b.still, path.join(projectDir, "assets", "broll", "open.png")); plan.coldOpen.src = "assets/broll/open.png"; }
    else if (!b.video) plan.coldOpen.src = b.src;
    else plan.coldOpen.src = null;
  }
  fs.writeFileSync(path.join(projectDir, "index.html"), renderHTML(plan, footage));
  return projectDir;
}

export function renderHTML(plan, footage) {
  const { width: W, height: H } = plan.canvas;
  const s = plan.style;
  const c = s.colors;
  const cap = s.captions;
  const hk = s.hook;
  const D = plan.video.duration;
  const capFont = Math.round(cap.fontSizeFrac * H);
  const stroke = r3(cap.strokeWidthFrac * H);
  const hookFont = Math.round(hk.fontSizeFrac * H);
  const hookStroke = r3((hk.strokeWidthFrac ?? cap.strokeWidthFrac) * H);
  const captions = plan.captions || [];
  const hookStyle = hk.style || "gold";
  const hookColor = hookStyle === "gold" ? c.accent : c.text;
  const headline = hookStyle === "headline";
  const hookBox = hookStyle === "box" ? `background: ${hexA(c.bg || "#0B0B0D", 0.86)}; padding: 0.18em 0.45em; border-radius: 0.14em; box-decoration-break: clone; -webkit-box-decoration-break: clone;` : "";
  const ct = s.cta || {};
  const ctaFont = Math.round((ct.fontSizeFrac || 0.036) * H);
  const ctaStyle = plan.cta?.style || ct.style || "pill";
  const ctaLook =
    ctaStyle === "text"
      ? `color: ${c.accent}; -webkit-text-stroke: ${r3(cap.strokeWidthFrac * H)}px ${c.stroke}; paint-order: stroke fill; text-shadow: ${cap.shadow};`
      : ctaStyle === "box"
        ? `color: ${c.text}; background: ${hexA(c.bg || "#0B0B0D", 0.92)}; border: 0.08em solid ${c.accent}; padding: 0.32em 0.8em; border-radius: 0.18em; box-shadow: 0 0.25em 0.9em rgba(0,0,0,0.45);`
        : `color: ${c.bg || "#0B0B0D"}; background: ${c.accent}; padding: 0.34em 0.9em; border-radius: 10em; box-shadow: 0 0.25em 0.9em rgba(0,0,0,0.45);`;

  // Caption looks: "pop" (Anton with a black outline, the line pops in) or "reveal" (heavy Inter, no outline; the
  // whole phrase shows dimmed and each word lights up as it is spoken).
  const reveal = cap.style === "reveal";
  // Hand-drawn marker on the gold word: a squiggle underline, or a loose circle around a number or amount. The
  // stroke draws on as the word is spoken (stroke-dashoffset, measured at runtime).
  const annotate = !!cap.annotate;
  const marker = (w, first) => {
    if (!annotate || !w.key || !first) return "";
    return /\d|\$/.test(w.text)
      ? `<svg class="an an-circle" viewBox="0 0 100 60" preserveAspectRatio="none" aria-hidden="true"><path d="M8 31 C 9 11, 36 3, 58 6 C 84 9, 98 19, 96 33 C 94 49, 70 58, 46 56 C 22 54, 4 45, 6 31 C 8 19, 24 11, 44 9"/></svg>`
      : `<svg class="an an-underline" viewBox="0 0 100 20" preserveAspectRatio="none" aria-hidden="true"><path d="M3 9 C 20 3, 36 14, 54 8 S 84 3, 97 10"/></svg>`;
  };
  const capsHTML = captions
    .map((g, i) => {
      const len = g.text.length;
      const scale = cap.shrinkAfterChars && len > cap.shrinkAfterChars ? Math.max(0.7, cap.shrinkAfterChars / len) : 1;
      const firstKey = g.words.findIndex((w) => w.key);
      const spans = g.words.map((w, j) => `<span class="w${w.key ? " k" : ""}" id="cap-${i}-w${j}">${esc(w.text)}${marker(w, j === firstKey)}</span>`).join("");
      return `      <div class="cap" id="cap-${i}" style="font-size:${Math.round(capFont * scale)}px"><div class="cap-line">${spans}</div></div>`;
    })
    .join("\n");

  // headline: words on a soft scrim (no box), one gold emphasis, a gold rule drawn under it.
  const hookWordList = plan.hook ? plan.hook.words || plan.hook.text.split(/\s+/).map((t) => ({ text: t })) : [];
  const hookInner = headline
    ? `<div id="hook-block"><div id="hook-scrim"></div><div id="hook-lines">${hookWordList.map((w) => `<span class="hw${w.key ? " k" : ""}">${esc(w.text)}</span>`).join(" ")}</div><div id="hook-bar"></div></div>`
    : `<span id="hook-text">${esc(plan.hook?.text || "")}</span>`;
  const hookHTML = plan.hook
    ? `      <div id="hook" class="clip" data-start="${plan.hook.start}" data-duration="${plan.hook.duration}" data-track-index="3" data-layout-allow-overflow>${hookInner}</div>`
    : "";

  const ctaHTML = plan.cta
    ? `      <div id="cta" class="clip" data-start="${plan.cta.start}" data-duration="${plan.cta.duration}" data-track-index="4" data-layout-allow-overflow><span id="cta-text">${esc(plan.cta.text)}</span></div>`
    : "";

  // B-roll stills: full-frame cutaways over the footage, under the captions. The voice keeps playing underneath.
  const brollList = (plan.broll || []).filter((b) => b.src);
  // The finish is HyperFrames' own grade on the image (preset, vignette and film grain from the preset's
  // broll.grade), with a short focus pull on the cut; the push or pan runs on a wrapper so the grade stays put.
  const grade = s.broll?.grade ? ` data-color-grading="${esc(JSON.stringify(s.broll.grade))}"` : "";
  const focusPull = Math.max(0, Math.min(1, s.broll?.focusPull ?? 0));
  const pullStyle = focusPull ? ` style="--hf-color-grading-blur: ${focusPull}"` : "";
  // The cut: hard (the default from the b-roll research), flash (the Social Flash recipe: a white wash with a warm
  // core on the frame of the cut, in and out), or blur (the still arrives from and leaves into a blur).
  const brollCut = ["flash", "blur"].includes(s.broll?.cut) ? s.broll.cut : "hard";
  // A still is an <img>; a generated clip (Runway) is a muted <video> that plays from its start while the cut holds.
  const brollMedia = (b) => (b.video
    ? `<video class="broll-media" src="${esc(b.src)}" data-start="${b.start}" data-duration="${b.duration}" data-track-index="2" muted playsinline${grade}${pullStyle}></video>`
    : `<img class="broll-media" src="${esc(b.src)}" alt=""${grade}${pullStyle} />`);
  const brollHTML = brollList
    .map((b, i) => `      <div id="broll-${i}" class="broll clip" data-start="${b.start}" data-duration="${b.duration}" data-track-index="2"><div class="broll-move">${brollMedia(b)}</div><div class="broll-shade"></div>${brollCut === "flash" ? '<div class="broll-flash"><div class="broll-flash-core"></div></div>' : ""}</div>`)
    .join("\n");

  // Cold open: the strongest still under the hook for the first beat, then a flash into the speaker.
  const open = plan.coldOpen && plan.coldOpen.src ? plan.coldOpen : null;
  const openHTML = open
    ? `      <div id="cold-open" class="broll clip" data-start="0" data-duration="${open.duration}" data-track-index="2"><div class="broll-move"><img src="${esc(open.src)}" alt=""${grade} /></div><div class="broll-shade"></div></div>
      <div id="open-flash" class="clip" data-start="0" data-duration="${r3(open.duration + 0.5)}" data-track-index="5" data-layout-allow-overflow><div class="broll-flash"></div><div class="broll-flash-core"></div></div>`
    : "";

  // Lower third: the name and handle once, early in the first chapter (long-form).
  const lt = plan.lowerThird;
  const lowerHTML = lt && lt.name
    ? `      <div id="lower-third" class="clip" data-start="${lt.at}" data-duration="${lt.duration}" data-track-index="3" data-layout-allow-overflow><div class="lt-bar"></div><div class="lt-text"><div class="lt-name">${esc(lt.name)}</div>${lt.handle ? `<div class="lt-handle">${esc(lt.handle)}</div>` : ""}</div></div>`
    : "";

  // Climax words: a gold word stamps in big in the top third as it is said.
  const slamList = plan.slams || [];
  const slamFont = (t) => Math.round(Math.min(0.115 * H, (0.86 * W) / Math.max(3, t.length * 0.52)));
  const slamHTML = slamList
    .map((sl, i) => `      <div id="slam-${i}" class="slam clip" data-start="${sl.t}" data-duration="${r3(sl.end - sl.t)}" data-track-index="3" data-layout-allow-overflow><div class="slam-stage"><div class="slam-word" style="font-size:${slamFont(sl.text)}px">${esc(sl.text)}</div></div></div>`)
    .join("\n");

  // Graphic scenes: designed full-screen cards over the footage, under the captions.
  const gfxList = plan.graphics || [];
  const gfxHTML = gfxList.map((g, i) => `      <div id="gfx-${i}" class="gfx clip gfx-${g.type}" data-start="${g.start}" data-duration="${g.duration}" data-track-index="2">${sceneHTML(g)}</div>`).join("\n");

  const tracks = plan.audio?.tracks || [];
  const audioHTML = tracks
    .map((t) => {
      const dur = t.duration ? ` data-duration="${t.duration}"` : "";
      // A lane (ducking: swell in the pauses) is in reel time; fades are relative to the clip start.
      const points = t.lane ? t.lane.map((p) => ({ t: r3(p.t - t.start), v: p.v })).filter((p) => p.t >= 0) : null;
      const vol =
        points || t.fadeIn || t.fadeOut
          ? ` data-automation="${esc(JSON.stringify({ version: 1, lanes: [{ target: "volume", points: points || fadePoints(t) }] }))}"`
          : ` data-volume="${t.volume ?? 1}"`;
      return `      <audio id="${esc(t.id)}" src="${esc(t.src)}" data-start="${t.start}"${dur} data-track-index="${t.track ?? 6}"${vol}></audio>`;
    })
    .join("\n");

  const videoAudio = plan.audio?.replaceAudio || !plan.video.hasAudio ? " muted" : ' data-has-audio="true"';

  const runtimePlan = {
    duration: D,
    hook: plan.hook ? { start: plan.hook.start, duration: plan.hook.duration, style: hookStyle, font: hookFont } : null,
    cta: plan.cta ? { start: plan.cta.start, duration: plan.cta.duration } : null,
    captions: captions.map((g) => ({ start: g.start, end: g.end, words: g.words.map((w) => [w.start, w.end]) })),
    activeWord: !!cap.activeWord,
    zooms: plan.zooms || [],
    broll: brollList.map((b) => ({ start: b.start, duration: b.duration, motion: b.video ? "none" : b.motion || "in", video: !!b.video })),
    graphics: gfxList.map((g) => ({ start: g.start, duration: g.duration })),
    graphicsMode: s.graphics?.mode || "overlay",
    slams: slamList.map((sl) => ({ t: sl.t, end: sl.end })),
    zoomStyle: s.zooms?.style || "snap",
    focusPull,
    brollCut,
    coldOpen: open ? { duration: open.duration } : null,
    lowerThird: lt && lt.name ? { at: lt.at, duration: lt.duration } : null,
    annotate,
    width: W,
    height: H,
    reveal,
    reframe: plan.reframe || [],
    fps: s.render?.fps || 30,
    base: plan.framing?.scale || 1,
    baseShift: Math.round((plan.framing?.shift || 0) * H),
  };
  const framing = plan.framing || { scale: 1, side: "right", face: null };
  const origin = framing.scale > 1 && framing.origin ? framing.origin : s.zooms.origin || "50% 40%";
  // Cards beside the speaker: the free third, vertically on the face.
  const fx = framing.face;
  // The box takes the empty third: from the frame edge to a fifth of a face width short of the face, never wider
  // than 30% of the frame (the podcast convention) and never under 22%.
  const room = fx ? (framing.side === "right" ? 1 - (fx.cx + fx.w / 2) : fx.cx - fx.w / 2) - 0.2 * fx.w - 0.04 : 0.3;
  const gw = Math.round(Math.max(0.22, Math.min(0.3, room)) * 100);
  const sideVars = fx
    ? `--gx: ${framing.side === "right" ? `${100 - 4 - gw}%` : "4%"}; --gw: ${gw}%; --gy: ${Math.round(Math.max(6, Math.min(50, (fx.cy - fx.h * 0.6) * 100)))}%; --ly: ${Math.round(Math.max(30, Math.min(80, (fx.cy + fx.h * 0.55) * 100)))}%;`
    : "--gx: 56%; --gw: 40%; --gy: 20%; --ly: 70%;";

  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=${W}, height=${H}" />
    <title>${esc(plan.name)}</title>
    <script src="assets/vendor/gsap.min.js"></script>
    <style>
      @font-face { font-family: "Anton"; src: url("assets/fonts/Anton-Regular.ttf") format("truetype"); font-weight: 400; font-style: normal; font-display: block; }
      @font-face { font-family: "Inter"; src: url("assets/fonts/Inter.ttf") format("truetype"); font-weight: 100 900; font-style: normal; font-display: block; }
      html, body { margin: 0; background: #000; }
      #root { position: relative; width: 100%; height: 100%; overflow: hidden; background: #000; }
      #video-wrap { position: absolute; inset: 0; transform-origin: ${origin}; will-change: transform; }
      #root { ${sideVars} }
      #footage { position: absolute; inset: 0; width: 100%; height: 100%; object-fit: cover; }
      /* Creator punch-in: the frame edges defocus for a beat while the camera moves (the centre stays sharp). */
      #defocus { position: absolute; inset: 0; opacity: 0; pointer-events: none; backdrop-filter: blur(7px); -webkit-backdrop-filter: blur(7px); -webkit-mask-image: radial-gradient(ellipse 62% 58% at 50% 45%, transparent 58%, rgba(0,0,0,0.85) 92%); mask-image: radial-gradient(ellipse 62% 58% at 50% 45%, transparent 58%, rgba(0,0,0,0.85) 92%); }
      .broll { position: absolute; inset: 0; overflow: hidden; opacity: 0; background: #000; }
      /* Finish: HyperFrames grades the still (muted editorial, vignette, film grain); the bottom keeps a scrim for the captions. */
      .broll-move { position: absolute; inset: 0; transform-origin: 50% 50%; will-change: transform; }
      .broll img, .broll video { position: absolute; inset: 0; width: 100%; height: 100%; object-fit: cover; }
      .broll-shade { position: absolute; inset: 0; background: linear-gradient(180deg, rgba(0,0,0,0) 55%, rgba(0,0,0,0.45) 100%); }
      .broll-flash { position: absolute; inset: -12%; opacity: 0; background: rgb(255,253,250); pointer-events: none; }
      #open-flash { position: absolute; inset: 0; overflow: hidden; pointer-events: none; }
      .broll-flash-core { position: absolute; inset: -18%; opacity: 0; background: radial-gradient(ellipse 68% 92% at 37% 47%, rgb(255,255,255) 0%, rgba(255,255,255,0.98) 20%, rgba(255,253,250,0.86) 45%, rgba(255,174,105,0.32) 67%, rgba(255,174,105,0) 100%); }
      #lower-third { position: absolute; left: 5%; top: 80%; display: flex; align-items: stretch; gap: ${Math.round(H * 0.012)}px; opacity: 0; pointer-events: none; }
      .lt-bar { width: ${Math.round(H * 0.008)}px; background: ${c.accent}; border-radius: ${Math.round(H * 0.004)}px; transform-origin: 50% 100%; }
      .lt-text { display: flex; flex-direction: column; justify-content: center; gap: ${Math.round(H * 0.004)}px; padding: ${Math.round(H * 0.008)}px 0; font-family: "Inter", sans-serif; color: ${c.text}; text-shadow: 0 0.06em 0.4em rgba(0,0,0,0.6); }
      .lt-name { font-size: ${Math.round(H * 0.04)}px; font-weight: 850; letter-spacing: -0.01em; line-height: 1; }
      .lt-handle { font-size: ${Math.round(H * 0.022)}px; font-weight: 600; color: ${c.accent}; letter-spacing: 0.04em; }
      .slam { position: absolute; inset: 0; opacity: 0; pointer-events: none; }
      .slam-stage { position: absolute; left: 5%; right: 5%; top: 4%; height: 18%; display: grid; place-items: center; }
      .slam-word { font-family: "Anton", sans-serif; font-weight: 400; line-height: 0.95; letter-spacing: 0.01em; text-transform: uppercase; color: ${c.accent}; white-space: nowrap; text-align: center; transform-origin: 50% 50%; -webkit-text-stroke: 0.016em ${c.stroke}; paint-order: stroke fill; text-shadow: 0 0.04em 0 rgba(0,0,0,0.6), 0 0.1em 0.45em rgba(0,0,0,0.6); will-change: transform, opacity; }
      .cap .w { position: relative; }
      .an { position: absolute; opacity: 0; overflow: visible; pointer-events: none; }
      .an path { fill: none; stroke: ${c.accent}; stroke-width: ${Math.max(3, Math.round(capFont * 0.085))}px; stroke-linecap: round; stroke-linejoin: round; vector-effect: non-scaling-stroke; }
      .an-underline { left: -3%; width: 106%; bottom: -0.2em; height: 0.24em; }
      .an-circle { left: -14%; width: 128%; top: -22%; height: 144%; }
${gfxList.length ? graphicsCSS({ W, H, colors: c, mode: s.graphics?.mode || "overlay" }) : ""}
      #captions { position: absolute; inset: 0; pointer-events: none; }
      .cap {
        position: absolute; left: ${r3(cap.sideMarginFrac * 100)}%; right: ${r3((cap.rightMarginFrac ?? cap.sideMarginFrac) * 100)}%; top: ${r3(cap.position * 100)}%;
        margin-top: -0.6em; display: flex; justify-content: center; opacity: 0;
      }
      .cap-line {
        display: inline-flex; flex-wrap: wrap; justify-content: center; gap: 0.02em 0.26em; max-width: 100%;
        font-family: "Anton", sans-serif; font-weight: 400; line-height: 1.08; letter-spacing: 0.012em;
        text-transform: ${cap.uppercase ? "uppercase" : "none"}; color: ${c.text}; text-align: center;
        -webkit-text-stroke: ${stroke}px ${c.stroke}; paint-order: stroke fill; text-shadow: ${cap.shadow};
        transform-origin: 50% 50%;
      }
      .cap .w { display: inline-block; transform-origin: 50% 50%; }
      .cap .w.k { color: ${c.accent}; }
${reveal ? `      .cap-line { font-family: "Inter", sans-serif; font-weight: 850; line-height: 1.04; letter-spacing: -0.01em; -webkit-text-stroke: 0; text-shadow: 0 0.04em 0.28em rgba(0,0,0,0.6), 0 0 0.8em rgba(0,0,0,0.3); gap: 0.02em 0.24em; max-width: 86%; }
      .cap .w { opacity: 0.38; }` : ""}
      #hook {
        position: absolute; inset: 0; display: flex; align-items: flex-start; justify-content: center;
        padding: ${Math.max(0, Math.round(hk.position * H - hookFont * 1.2))}px 7% 0; box-sizing: border-box;
        font-family: "Anton", sans-serif; font-weight: 400; font-size: ${hookFont}px; line-height: 1.05; letter-spacing: 0.01em;
        text-transform: uppercase; color: ${hookColor}; text-align: center;
        -webkit-text-stroke: ${hookStroke}px ${c.stroke}; paint-order: stroke fill; text-shadow: ${hk.shadow || cap.shadow};
      }
      #hook-block { position: absolute; left: 4%; right: 4%; top: ${Math.round(hk.position * H)}px; text-align: center; }
      #hook-scrim { position: absolute; inset: -38% -8%; background: radial-gradient(ellipse at 50% 50%, rgba(0,0,0,0.66) 0%, rgba(0,0,0,0.44) 46%, rgba(0,0,0,0) 74%); }
      #hook-lines { position: relative; font-size: 1.08em; line-height: 1.0; text-wrap: balance; -webkit-text-stroke: ${r3(hookStroke * 0.45)}px ${c.stroke}; text-shadow: 0 0.035em 0 rgba(0,0,0,0.55), 0 0.08em 0.45em rgba(0,0,0,0.6); color: ${c.text}; }
      #hook-lines .hw { display: inline-block; margin: 0 0.04em; }
      #hook-lines .hw.k { color: ${c.accent}; font-size: 1.14em; }
      #hook-bar { position: relative; margin: 0.28em auto 0; width: 22%; height: ${Math.max(8, Math.round(hookFont * 0.1))}px; background: ${c.accent}; border-radius: ${Math.max(3, Math.round(hookFont * 0.035))}px; box-shadow: 0 0.1em 0.4em rgba(0,0,0,0.5); transform-origin: 50% 50%; }
      #hook-text { display: inline-flex; align-items: center; justify-content: center; min-height: 2.4em; max-width: 100%; transform-origin: 50% 50%; ${hookBox} }
      #cta {
        position: absolute; inset: 0; display: flex; align-items: flex-start; justify-content: center;
        padding: ${Math.max(0, Math.round((plan.cta?.position ?? ct.position ?? 0.62) * H - ctaFont * 0.9))}px 7% 0; box-sizing: border-box;
        font-family: "Anton", sans-serif; font-weight: 400; font-size: ${ctaFont}px; line-height: 1.1; letter-spacing: 0.03em;
        text-transform: ${ct.uppercase === false ? "none" : "uppercase"}; text-align: center;
      }
      #cta-text { display: inline-block; max-width: 100%; transform-origin: 50% 50%; ${ctaLook} }
    </style>
  </head>
  <body>
    <div id="root" data-composition-id="reel" data-start="0" data-width="${W}" data-height="${H}" data-duration="${D}" data-fps="${s.render?.fps || 30}"${plan.video.hasAudio || tracks.length ? ` data-fx-chain="${esc(JSON.stringify({ version: 1, nodes: [{ type: "truepeak", id: "ceiling", label: "Delivery ceiling", params: { ceiling: -1.5, lookahead: 3, release: 80 } }] }))}"` : ""}>
      <div id="video-wrap" data-layout-allow-overflow>
        <video id="footage" src="${footage}" data-start="0" data-duration="${D}" data-track-index="0"${videoAudio} playsinline></video>
      </div>
${runtimePlan.zoomStyle === "camera" && runtimePlan.zooms.length ? `      <div id="defocus"></div>` : ""}
${openHTML}
${brollHTML}
${lowerHTML}
${gfxHTML}
${slamHTML}
      <div id="captions" data-layout-allow-caption-zone data-layout-allow-overflow>
${capsHTML}
      </div>
${hookHTML}
${ctaHTML}
${audioHTML}
    </div>
    <script>
      const PLAN = ${JSON.stringify(runtimePlan)};
      (function () {
        const tl = gsap.timeline({ paused: true });
        if (PLAN.hook && PLAN.hook.style === "headline") {
          const h = PLAN.hook;
          const words = document.querySelectorAll("#hook-lines .hw");
          const step = 0.06;
          // Frame 0 carries the whole hook at full strength (reels that spread show text by frame 4); the words
          // settle from a slight lift, the gold phrase pulses once and the rule draws in under it.
          const t0 = h.start;
          const done = t0 + 0.3 + step * words.length;
          tl.set("#hook-scrim", { opacity: 1 }, h.start);
          tl.fromTo(words, { opacity: 1, y: h.font * 0.12 }, { opacity: 1, y: 0, duration: 0.3, ease: "power3.out", stagger: step * 0.5 }, t0);
          tl.fromTo("#hook-lines .hw.k", { scale: 1 }, { scale: 1.09, duration: 0.13, ease: "power2.out", yoyo: true, repeat: 1 }, done - 0.05);
          tl.fromTo("#hook-bar", { scaleX: 0 }, { scaleX: 1, duration: 0.36, ease: "power3.inOut" }, h.start + 0.08);
          tl.to("#hook-block", { opacity: 0, y: -h.font * 0.3, duration: 0.24, ease: "power2.in" }, h.start + h.duration - 0.28);
        } else if (PLAN.hook) {
          const h = PLAN.hook;
          tl.fromTo("#hook-text", { opacity: 0, scale: 0.7, y: 30 }, { opacity: 1, scale: 1, y: 0, duration: 0.35, ease: "back.out(1.7)" }, h.start + 0.04);
          tl.to("#hook-text", { opacity: 0, scale: 0.96, duration: 0.2, ease: "power2.in" }, h.start + h.duration - 0.24);
        }
        if (PLAN.cta) {
          const k = PLAN.cta;
          tl.fromTo("#cta-text", { opacity: 0, scale: 0.6, y: 24 }, { opacity: 1, scale: 1, y: 0, duration: 0.32, ease: "back.out(2.2)" }, k.start + 0.02);
          tl.to("#cta-text", { scale: 1.06, duration: 0.18, ease: "power1.inOut", yoyo: true, repeat: 1 }, k.start + 0.9);
          if (k.duration > 1.2) tl.to("#cta-text", { opacity: 0, scale: 0.9, duration: 0.18, ease: "power2.in" }, k.start + k.duration - 0.22);
        }
        // Hand-drawn markers: measure each stroke once so the draw-on is a plain dash offset (seek-safe).
        if (PLAN.annotate) document.querySelectorAll(".an path").forEach((p) => { const L = p.getTotalLength(); p.style.strokeDasharray = L + " " + L; p.style.strokeDashoffset = L; });
        PLAN.captions.forEach((g, i) => {
          const el = document.getElementById("cap-" + i);
          const line = el.firstElementChild;
          tl.set(el, { opacity: 1 }, g.start);
          if (PLAN.annotate) g.words.forEach((w, j) => {
            const we = document.getElementById("cap-" + i + "-w" + j);
            const svg = we && we.querySelector(".an");
            if (!svg) return;
            const p = svg.querySelector("path");
            const L = parseFloat(p.style.strokeDashoffset);
            const at = Math.max(g.start, w[0]) + 0.04;
            tl.set(svg, { opacity: 1 }, at);
            tl.fromTo(p, { strokeDashoffset: L }, { strokeDashoffset: 0, duration: 0.38, ease: "power2.inOut", immediateRender: false }, at);
            tl.fromTo(we, { scale: 1 }, { scale: 1.06, duration: 0.09, ease: "power2.out", yoyo: true, repeat: 1, immediateRender: false }, at + 0.28);
          });
          if (PLAN.reveal) {
            tl.fromTo(line, { y: 14, opacity: 0 }, { y: 0, opacity: 1, duration: 0.12, ease: "power2.out" }, g.start);
            g.words.forEach((w, j) => tl.fromTo("#cap-" + i + "-w" + j, { opacity: 0.38 }, { opacity: 1, duration: 0.07, ease: "none", immediateRender: false }, Math.max(g.start, w[0])));
          } else {
            tl.fromTo(line, { scale: 0.8 }, { scale: 1, duration: 0.16, ease: "back.out(2.5)" }, g.start);
          }
          if (PLAN.activeWord) {
            g.words.forEach((w, j) => {
              const we = document.getElementById("cap-" + i + "-w" + j);
              tl.fromTo(we, { scale: 1 }, { scale: 1.08, duration: 0.09, ease: "power2.out", yoyo: true, repeat: 1 }, w[0]);
            });
          }
          tl.set(el, { opacity: 0 }, g.end);
        });
        // Face-tracking reframe: slide the crop window across a wide source as the speaker moves.
        if (PLAN.reframe.length) {
          const first = PLAN.reframe[0];
          tl.set("#footage", { objectPosition: first.x + "% 50%" }, 0);
          for (let i = 1; i < PLAN.reframe.length; i++) {
            const p = PLAN.reframe[i], q = PLAN.reframe[i - 1];
            tl.to("#footage", { objectPosition: p.x + "% 50%", duration: Math.max(0.2, p.t - q.t), ease: "power1.inOut" }, q.t);
          }
        }
        // Base framing (long form): a tighter default frame on a wide shot; every punch-in is relative to it.
        const BASE = PLAN.base || 1;
        if (BASE !== 1 || PLAN.baseShift) tl.set("#video-wrap", { scale: BASE, y: PLAN.baseShift || 0 }, 0);
        // Motion from the first frame: a slow push-in under the hook (a static face in frame 1 reads as a still).
        if (PLAN.hook) tl.fromTo("#video-wrap", { scale: BASE }, { scale: BASE * 1.06, duration: Math.max(1, PLAN.hook.duration), ease: "power1.out" }, 0);
        // Punch-ins. "camera": the creator move (push with a slight tilt and lift, the edges defocus for a beat, a slow
        // return); "snap": the hard cut-in zoom.
        // Cut cadence: an instant change of framing (a jump cut) between the punch-ins.
        const jump = (z) => tl.set("#video-wrap", { scale: z.scale * BASE, xPercent: z.xPercent || 0, yPercent: z.scale > 1 ? -0.6 : 0, rotationX: 0, rotationY: 0 }, z.t);
        if (PLAN.zoomStyle === "camera") {
          gsap.set("#video-wrap", { transformPerspective: 1200 });
          let n = 0;
          PLAN.zooms.forEach((z) => {
            if (z.cut) jump(z);
            else if (z.scale > 1) {
              const dir = n++ % 2 ? 1 : -1;
              tl.to("#video-wrap", { scale: z.scale * BASE, yPercent: -1.2, rotationX: 1.8, rotationY: 1.2 * dir, duration: 0.55, ease: "power3.out" }, z.t);
              tl.to("#defocus", { opacity: 1, duration: 0.3, ease: "power2.out" }, z.t);
              tl.to("#defocus", { opacity: 0, duration: 0.45, ease: "power2.in" }, z.t + 0.3);
            } else {
              tl.to("#video-wrap", { scale: BASE, xPercent: 0, yPercent: 0, rotationX: 0, rotationY: 0, duration: 0.9, ease: "power2.inOut" }, z.t);
            }
          });
        } else PLAN.zooms.forEach((z) => (z.cut ? jump(z) : tl.to("#video-wrap", { scale: z.scale * BASE, xPercent: 0, duration: z.snap, ease: "power3.out" }, z.t)));
        // Cold open: the still holds under the hook with a slow push, the flash hits on the cut to the speaker.
        if (PLAN.coldOpen) {
          const d = PLAN.coldOpen.duration;
          tl.set("#cold-open", { opacity: 1 }, 0);
          tl.fromTo("#cold-open .broll-move", { scale: 1.04 }, { scale: 1.1, duration: d, ease: "none" }, 0);
          tl.set("#cold-open", { opacity: 0 }, d);
          const wash = document.querySelector("#open-flash .broll-flash"), core = document.querySelector("#open-flash .broll-flash-core");
          tl.fromTo(wash, { opacity: 0 }, { opacity: 0.92, duration: 0.04, ease: "power4.in", immediateRender: false }, d - 0.04);
          tl.fromTo(core, { opacity: 0, scale: 0.86 }, { opacity: 1, scale: 1, duration: 0.05, ease: "power4.in", immediateRender: false }, d - 0.04);
          tl.to(wash, { opacity: 0, duration: 0.18, ease: "power3.out" }, d);
          tl.to(core, { opacity: 0, scale: 1.18, duration: 0.3, ease: "power2.out" }, d + 0.01);
        }
${gfxList.length ? GRAPHICS_JS : ""}
        // B-roll: hard cut in and out. The push (6%, ease-out, settles before the end) and the Ken Burns pans (a
        // steady drift with a little scale, no ease) run on the wrapper; the cut lands with a short focus pull.
        // A generated clip already moves, so it gets no push: "none" holds the frame.
        const MOVES = { none: [{ scale: 1.0 }, { scale: 1.0, ease: "none" }], in: [{ scale: 1.0 }, { scale: 1.06, ease: "power2.out" }], out: [{ scale: 1.06 }, { scale: 1.0, ease: "power2.out" }], left: [{ scale: 1.04, xPercent: 1.6 }, { scale: 1.07, xPercent: -1.6, ease: "none" }], right: [{ scale: 1.04, xPercent: -1.6 }, { scale: 1.07, xPercent: 1.6, ease: "none" }] };
        PLAN.broll.forEach((b, i) => {
          const el = document.getElementById("broll-" + i);
          const m = MOVES[b.motion] || MOVES.in;
          const img = el.querySelector(".broll-media");
          const bEnd = b.start + b.duration;
          if (PLAN.brollCut === "blur") {
            tl.fromTo(el, { opacity: 0 }, { opacity: 1, duration: 0.3, ease: "power2.out" }, b.start);
            tl.fromTo(img, { "--hf-color-grading-blur": 1 }, { "--hf-color-grading-blur": 0, duration: 0.45, ease: "power3.out", immediateRender: false }, b.start);
            tl.to(img, { "--hf-color-grading-blur": 1, duration: 0.35, ease: "power2.in" }, bEnd - 0.35);
            tl.to(el, { opacity: 0, duration: 0.25, ease: "power2.in" }, bEnd - 0.25);
          } else {
            tl.set(el, { opacity: 1 }, b.start);
            if (PLAN.focusPull) tl.fromTo(img, { "--hf-color-grading-blur": PLAN.focusPull }, { "--hf-color-grading-blur": 0, duration: 0.32, ease: "power3.out", immediateRender: false }, b.start);
            tl.set(el, { opacity: 0 }, bEnd);
          }
          tl.fromTo(el.querySelector(".broll-move"), m[0], { ...m[1], duration: b.duration * 0.92 }, b.start);
          if (PLAN.brollCut === "flash") {
            // Flash on both cuts: the wash hits in 0.04 s and clears in 0.18 s; the warm core blooms and drifts out.
            const wash = el.querySelector(".broll-flash"), core = el.querySelector(".broll-flash-core");
            [b.start, bEnd - 0.24].forEach((at) => {
              tl.fromTo(wash, { opacity: 0 }, { opacity: 0.92, duration: 0.04, ease: "power4.in", immediateRender: false }, at);
              tl.fromTo(core, { opacity: 0, scale: 0.86 }, { opacity: 1, scale: 1, duration: 0.05, ease: "power4.in", immediateRender: false }, at);
              tl.to(wash, { opacity: 0, duration: 0.18, ease: "power3.out" }, at + 0.04);
              tl.to(core, { opacity: 0, scale: 1.18, duration: 0.3, ease: "power2.out" }, at + 0.05);
            });
          }
        });
        // Lower third: the bar grows, the text slides in from behind it, then both leave the way they came.
        if (PLAN.lowerThird) {
          const l = PLAN.lowerThird;
          tl.set("#lower-third", { opacity: 1 }, l.at);
          tl.fromTo("#lower-third .lt-bar", { scaleY: 0 }, { scaleY: 1, duration: 0.35, ease: "power3.out" }, l.at);
          tl.fromTo("#lower-third .lt-text", { x: -30, opacity: 0 }, { x: 0, opacity: 1, duration: 0.4, ease: "power3.out" }, l.at + 0.15);
          tl.to("#lower-third .lt-text", { x: -30, opacity: 0, duration: 0.3, ease: "power2.in" }, l.at + l.duration - 0.45);
          tl.to("#lower-third .lt-bar", { scaleY: 0, duration: 0.25, ease: "power2.in" }, l.at + l.duration - 0.3);
          tl.set("#lower-third", { opacity: 0 }, l.at + l.duration);
        }
        // Climax words: slam down from 1.6x with expo weight, a three-frame impact shake, a quiet drift, a whip up and out.
        const frame = 1 / (PLAN.fps || 30);
        PLAN.slams.forEach((sl, i) => {
          const el = document.getElementById("slam-" + i);
          const stage = el.querySelector(".slam-stage");
          const word = el.querySelector(".slam-word");
          const land = 0.42;
          const outAt = Math.max(sl.t + land + 3 * frame, sl.end - 0.28);
          tl.set(el, { opacity: 1 }, sl.t);
          tl.fromTo(word, { scale: 1.6, opacity: 0, y: 0 }, { scale: 1, opacity: 1, y: 0, duration: land, ease: "expo.out" }, sl.t);
          tl.to(stage, { x: PLAN.width * 0.0055, y: -PLAN.height * 0.003, duration: frame, ease: "power2.out" }, sl.t + land);
          tl.to(stage, { x: -PLAN.width * 0.0038, y: PLAN.height * 0.002, duration: frame, ease: "power2.out" }, sl.t + land + frame);
          tl.to(stage, { x: 0, y: 0, duration: frame, ease: "power2.out" }, sl.t + land + 2 * frame);
          const hold = outAt - (sl.t + land + 3 * frame);
          if (hold > 0.2) tl.to(word, { y: -PLAN.height * 0.0055, duration: hold / 2, ease: "sine.inOut", yoyo: true, repeat: 1 }, sl.t + land + 3 * frame);
          tl.to(word, { y: -PLAN.height * 0.3, opacity: 0, duration: 0.28, ease: "power4.in" }, outAt);
          tl.set(el, { opacity: 0 }, sl.end);
        });
        window.__timelines["reel"] = tl;
      })();
    </script>
  </body>
</html>
`;
}
