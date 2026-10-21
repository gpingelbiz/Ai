import fs from "node:fs";
import path from "node:path";
import { ensureDir, copyOrLink, r3, PKG_ROOT } from "./util.mjs";

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

  const capsHTML = captions
    .map((g, i) => {
      const len = g.text.length;
      const scale = cap.shrinkAfterChars && len > cap.shrinkAfterChars ? Math.max(0.7, cap.shrinkAfterChars / len) : 1;
      const spans = g.words.map((w, j) => `<span class="w${w.key ? " k" : ""}" id="cap-${i}-w${j}">${esc(w.text)}</span>`).join("");
      return `      <div class="cap" id="cap-${i}" style="font-size:${Math.round(capFont * scale)}px"><div class="cap-line">${spans}</div></div>`;
    })
    .join("\n");

  const hookHTML = plan.hook
    ? `      <div id="hook" class="clip" data-start="${plan.hook.start}" data-duration="${plan.hook.duration}" data-track-index="3" data-layout-allow-overflow><span id="hook-text">${esc(plan.hook.text)}</span></div>`
    : "";

  const ctaHTML = plan.cta
    ? `      <div id="cta" class="clip" data-start="${plan.cta.start}" data-duration="${plan.cta.duration}" data-track-index="4" data-layout-allow-overflow><span id="cta-text">${esc(plan.cta.text)}</span></div>`
    : "";

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
    hook: plan.hook ? { start: plan.hook.start, duration: plan.hook.duration } : null,
    cta: plan.cta ? { start: plan.cta.start, duration: plan.cta.duration } : null,
    captions: captions.map((g) => ({ start: g.start, end: g.end, words: g.words.map((w) => [w.start, w.end]) })),
    activeWord: !!cap.activeWord,
    zooms: plan.zooms || [],
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
      #hook {
        position: absolute; inset: 0; display: flex; align-items: flex-start; justify-content: center;
        padding: ${Math.max(0, Math.round(hk.position * H - hookFont * 1.2))}px 7% 0; box-sizing: border-box;
        font-family: "Anton", sans-serif; font-weight: 400; font-size: ${hookFont}px; line-height: 1.05; letter-spacing: 0.01em;
        text-transform: uppercase; color: ${hookColor}; text-align: center;
        -webkit-text-stroke: ${hookStroke}px ${c.stroke}; paint-order: stroke fill; text-shadow: ${hk.shadow || cap.shadow};
      }
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
        if (PLAN.hook) {
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
          tl.fromTo(line, { scale: 0.8 }, { scale: 1, duration: 0.16, ease: "back.out(2.5)" }, g.start);
          if (PLAN.activeWord) {
            g.words.forEach((w, j) => {
              const we = document.getElementById("cap-" + i + "-w" + j);
              tl.fromTo(we, { scale: 1 }, { scale: 1.08, duration: 0.09, ease: "power2.out", yoyo: true, repeat: 1 }, w[0]);
            });
          }
          tl.set(el, { opacity: 0 }, g.end);
        });
        PLAN.zooms.forEach((z) => tl.to("#video-wrap", { scale: z.scale, duration: z.snap, ease: "power3.out" }, z.t));
        window.__timelines["reel"] = tl;
      })();
    </script>
  </body>
</html>
`;
}
