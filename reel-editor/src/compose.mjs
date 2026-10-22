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

const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

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
  const ext = path.extname(plan.video.src) || ".mp4";
  const footage = `assets/footage${ext}`;
  copyOrLink(plan.video.src, path.join(projectDir, footage));
  (plan.broll || []).forEach((b, i) => {
    b.src = `assets/broll/broll-${i + 1}${path.extname(b.file) || ".png"}`;
    copyOrLink(b.file, path.join(projectDir, b.src));
  });
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
  const capsHTML = captions
    .map((g, i) => {
      const len = g.text.length;
      const scale = cap.shrinkAfterChars && len > cap.shrinkAfterChars ? Math.max(0.7, cap.shrinkAfterChars / len) : 1;
      const spans = g.words.map((w, j) => `<span class="w${w.key ? " k" : ""}" id="cap-${i}-w${j}">${esc(w.text)}</span>`).join("");
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
  const brollHTML = brollList
    .map((b, i) => `      <div id="broll-${i}" class="broll clip" data-start="${b.start}" data-duration="${b.duration}" data-track-index="2"><img src="${esc(b.src)}" alt="" /><div class="broll-shade"></div></div>`)
    .join("\n");

  // Graphic scenes: designed full-screen cards over the footage, under the captions.
  const gfxList = plan.graphics || [];
  const gfxHTML = gfxList.map((g, i) => `      <div id="gfx-${i}" class="gfx clip gfx-${g.type}" data-start="${g.start}" data-duration="${g.duration}" data-track-index="2">${sceneHTML(g)}</div>`).join("\n");

  const tracks = plan.audio?.tracks || [];
  const audioHTML = tracks
    .map((t) => {
      const dur = t.duration ? ` data-duration="${t.duration}"` : "";
      const vol =
        t.fadeIn || t.fadeOut
          ? ` data-automation='${JSON.stringify({ version: 1, lanes: [{ target: "volume", points: fadePoints(t) }] })}'`
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
    broll: brollList.map((b) => ({ start: b.start, duration: b.duration, motion: b.motion || "in" })),
    graphics: gfxList.map((g) => ({ start: g.start, duration: g.duration })),
    reveal,
  };

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
      #video-wrap { position: absolute; inset: 0; transform-origin: ${s.zooms.origin || "50% 40%"}; will-change: transform; }
      #footage { position: absolute; inset: 0; width: 100%; height: 100%; object-fit: cover; }
      .broll { position: absolute; inset: 0; overflow: hidden; opacity: 0; background: #000; }
      .broll img { position: absolute; inset: 0; width: 100%; height: 100%; object-fit: cover; transform-origin: 50% 50%; will-change: transform; }
      .broll-shade { position: absolute; inset: 0; background: linear-gradient(180deg, rgba(0,0,0,0) 52%, rgba(0,0,0,0.42) 100%); }
${gfxList.length ? graphicsCSS({ W, H, colors: c }) : ""}
      #captions { position: absolute; inset: 0; pointer-events: none; }
      .cap {
        position: absolute; left: ${r3(cap.sideMarginFrac * 100)}%; right: ${r3(cap.sideMarginFrac * 100)}%; top: ${r3(cap.position * 100)}%;
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
    <div id="root" data-composition-id="reel" data-start="0" data-width="${W}" data-height="${H}" data-duration="${D}" data-fps="${s.render?.fps || 30}">
      <div id="video-wrap" data-layout-allow-overflow>
        <video id="footage" src="${footage}" data-start="0" data-duration="${D}" data-track-index="0"${videoAudio} playsinline></video>
      </div>
${brollHTML}
${gfxHTML}
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
          const t0 = h.start + 0.04;
          const done = t0 + step * words.length + 0.2;
          tl.fromTo("#hook-scrim", { opacity: 0 }, { opacity: 1, duration: 0.3, ease: "power1.out" }, h.start);
          tl.fromTo(words, { opacity: 0, y: h.font * 0.42 }, { opacity: 1, y: 0, duration: 0.34, ease: "power3.out", stagger: step }, t0);
          tl.fromTo("#hook-lines .hw.k", { scale: 1 }, { scale: 1.09, duration: 0.13, ease: "power2.out", yoyo: true, repeat: 1 }, done - 0.05);
          tl.fromTo("#hook-bar", { scaleX: 0 }, { scaleX: 1, duration: 0.36, ease: "power3.inOut" }, done - 0.12);
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
        PLAN.captions.forEach((g, i) => {
          const el = document.getElementById("cap-" + i);
          const line = el.firstElementChild;
          tl.set(el, { opacity: 1 }, g.start);
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
        PLAN.zooms.forEach((z) => tl.to("#video-wrap", { scale: z.scale, duration: z.snap, ease: "power3.out" }, z.t));
${gfxList.length ? GRAPHICS_JS : ""}
        // B-roll: quick dissolve in and out, slow push or pan while it holds.
        const MOVES = { in: [{ scale: 1.04 }, { scale: 1.14 }], out: [{ scale: 1.16 }, { scale: 1.04 }], left: [{ scale: 1.14, xPercent: 3 }, { scale: 1.14, xPercent: -3 }], right: [{ scale: 1.14, xPercent: -3 }, { scale: 1.14, xPercent: 3 }] };
        PLAN.broll.forEach((b, i) => {
          const el = document.getElementById("broll-" + i);
          const m = MOVES[b.motion] || MOVES.in;
          tl.fromTo(el, { opacity: 0 }, { opacity: 1, duration: 0.14, ease: "power1.out" }, b.start);
          tl.fromTo(el.querySelector("img"), m[0], { ...m[1], duration: b.duration, ease: "none" }, b.start);
          tl.to(el, { opacity: 0, duration: 0.14, ease: "power1.in" }, b.start + b.duration - 0.14);
        });
        window.__timelines["reel"] = tl;
      })();
    </script>
  </body>
</html>
`;
}
