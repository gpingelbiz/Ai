/**
 * Glow display elements: the full-screen scenes (on the brand's dark ground) and the band overlays (over the speaker)
 * of the glow look. Each element type has markup, styles and a timeline; the plan says what to show and when.
 *
 * Scenes: icons, number, meter, list, steps, versus, quote, people. Overlays: notify, stamp.
 * Icon images are already copied into the project (icon.image); words carry their spoken start times.
 */

const r3 = (x) => Math.round(x * 1000) / 1000;

function hexA(hex, a) {
  const h = String(hex || "#000000").replace("#", "");
  const n = parseInt(h.length === 3 ? h.split("").map((c) => c + c).join("") : h.slice(0, 6), 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
}

/** "$9.99" → { prefix "$", value 9.99, decimals 2, suffix "" }; null when there is no number to count. */
export function splitNumber(text) {
  const m = String(text || "").match(/^([^\d]*?)(\d[\d,]*(?:\.\d+)?)(.*)$/);
  if (!m) return null;
  const digits = m[2].replace(/,/g, "");
  return { prefix: m[1], value: Number(digits), decimals: (digits.split(".")[1] || "").length, comma: m[2].includes(","), suffix: m[3] };
}

const img = (icon, id, size, esc, cls = "") => icon?.image ? `<img${id ? ` id="${id}"` : ""} class="gs-img${cls ? ` ${cls}` : ""}" src="${esc(icon.image)}" style="width:${size}px;height:${size}px" alt="">` : "";
const wordsHTML = (words, i, esc, prefix = "gs") => (words || []).map((w, j) => `<span class="gsw${w.key ? " k" : ""}" id="${prefix}-${i}-w${j}">${esc(w.text)}</span>`).join(" ");

function sceneInner(scene, i, { W, H, esc }) {
  const id = (s) => `gs-${i}-${s}`;
  switch (scene.type) {
    case "number": {
      return `${scene.icon ? `<div class="gs-top">${img(scene.icon, id("i0"), Math.round(W * 0.3), esc)}</div>` : ""}<div class="gs-num" id="${id("num")}">${esc(scene.value)}</div><div class="gs-label">${wordsHTML(scene.labelWords, i, esc)}</div>`;
    }
    case "meter": {
      return `<div class="gs-num gs-num-meter" id="${id("num")}">${esc(scene.value)}</div><div class="gs-bar"><div class="gs-fill" id="${id("fill")}" style="width:${Math.max(0, Math.min(100, scene.percent))}%"></div></div><div class="gs-label gs-label-meter">${wordsHTML(scene.labelWords, i, esc)}</div>`;
    }
    case "list": {
      const size = Math.round(W * (scene.items.length > 3 ? 0.17 : 0.21));
      return `<div class="gs-list">${scene.items.map((it, k) => `<div class="gs-row" id="${id(`r${k}`)}">${img(it.icon, "", size, esc)}<span class="gs-row-label">${esc(it.label)}</span></div>`).join("")}</div>`;
    }
    case "steps": {
      return `<div class="gs-steps"><div class="gs-line" id="${id("line")}"></div>${scene.items.map((it, k) => `<div class="gs-step" id="${id(`r${k}`)}"><span class="gs-node">${k + 1}</span><span class="gs-row-label">${esc(it.label)}</span></div>`).join("")}</div>`;
    }
    case "versus": {
      const size = Math.round(W * 0.34);
      // A label's longest word must fit its column (42% of the width): long single words get a smaller size.
      const fit = (label) => Math.round(Math.min(0.04 * H, (0.42 * W * 0.92) / (Math.max(...String(label).split(/\s+/).map((w) => w.length), 1) * 0.68)));
      const side = (s, k, badge) => `<div class="gs-vs-side gs-vs-${k}" id="${id(k)}">${img(s.icon, "", size, esc)}<span class="gs-vs-label" style="font-size:${fit(s.label)}px">${esc(s.label)}</span>${badge ? `<div class="gs-badge" id="${id(`${k}b`)}">${img(badge, "", Math.round(W * 0.11), esc)}</div>` : ""}</div>`;
      return `<div class="gs-vs">${side(scene.left, "l", scene.cross)}<div class="gs-vs-mid">VS</div>${side(scene.right, "r", scene.check)}</div>`;
    }
    case "quote": {
      return `<div class="gs-phone"><div class="gs-phone-notch"></div><div class="gs-who">${esc(scene.who)}</div><div class="gs-bubble" id="${id("bubble")}">${wordsHTML(scene.words, i, esc)}</div></div>`;
    }
    case "people": {
      const per = Math.min(5, scene.count);
      const size = Math.round((W * 0.84) / per * 0.86);
      return `<div class="gs-people">${Array.from({ length: scene.count }, (_, k) => img(scene.icon, id(`p${k}`), size, esc, "gs-person")).join("")}</div><div class="gs-label gs-label-people">${wordsHTML(scene.labelWords, i, esc)}</div>`;
    }
    default: {
      const icons = (scene.icons || []).filter((icon) => icon.image);
      const size = Math.round(W * (icons.length === 1 ? 0.5 : icons.length === 2 ? 0.38 : 0.29));
      return `<div class="gs-icons">${icons.map((icon, k) => img(icon, id(`i${k}`), size, esc)).join("")}</div><div class="gs-text">${wordsHTML(scene.words, i, esc)}</div>`;
    }
  }
}

export function glowScenesHTML(scenes, { W, H, esc }) {
  return scenes.map((scene, i) => `      <div id="gscene-${i}" class="glow-scene gst-${scene.type || "icons"} clip" data-start="${scene.start}" data-duration="${r3(scene.end - scene.start)}" data-track-index="3" data-layout-allow-overflow>${sceneInner(scene, i, { W, H, esc })}</div>`).join("\n");
}

export function glowOverlaysHTML(overlays, { W, H, esc }) {
  return overlays.map((o, i) => {
    const pos = `left:${o.place.x}px;top:${o.place.y}px;width:${o.place.w}px`;
    if (o.type === "stamp") return `      <div id="gover-${i}" class="glow-over go-stamp clip" style="${pos}" data-start="${o.start}" data-duration="${r3(o.end - o.start)}" data-track-index="3" data-layout-allow-overflow><span id="go-${i}-word">${esc(o.text)}</span></div>`;
    return `      <div id="gover-${i}" class="glow-over go-notify clip" style="${pos}" data-start="${o.start}" data-duration="${r3(o.end - o.start)}" data-track-index="3" data-layout-allow-overflow><div class="go-card" id="go-${i}-card">${o.icon?.image ? `<img class="go-icon" src="${esc(o.icon.image)}" alt="">` : ""}<div class="go-body"><div class="go-who">${esc(o.who)}</div><div class="go-text">${wordsHTML(o.words, i, esc, "go")}</div></div></div></div>`;
  }).join("\n");
}

export function glowScenesCSS({ W, H, c }) {
  const accent = c.accent, text = c.text, bg = c.bg || "#0B0B0D";
  const glow = `0 0 0.12em rgba(255,255,255,0.5), 0 0 0.45em rgba(255,255,255,0.2)`;
  const goldGlow = `0 0 0.14em ${hexA(accent, 0.7)}, 0 0 0.5em ${hexA(accent, 0.32)}`;
  const px = (f) => Math.round(f * H);
  return `
      .glow-scene { position: absolute; inset: 0; opacity: 0; pointer-events: none; background: radial-gradient(ellipse 70% 45% at 50% 40%, ${hexA(accent, 0.22)} 0%, ${hexA(accent, 0.06)} 45%, ${hexA(bg, 0)} 75%), radial-gradient(ellipse at 50% 50%, #1a1814 0%, ${bg} 80%); font-family: "Inter", sans-serif; color: ${text}; }
      .gs-img { object-fit: contain; filter: drop-shadow(0 30px 60px rgba(0,0,0,0.6)) drop-shadow(0 0 70px ${hexA(accent, 0.3)}); }
      .gs-icons { position: absolute; left: 6%; right: 6%; top: 24%; height: 30%; display: flex; align-items: center; justify-content: center; gap: 2%; }
      .gs-text, .gs-label { position: absolute; left: 8%; right: 8%; top: 60%; text-align: center; font-weight: 760; font-size: ${px(0.042)}px; line-height: 1.12; letter-spacing: 0.012em; word-spacing: 0.1em; text-transform: uppercase; text-wrap: balance; text-shadow: ${glow}; }
      .gsw { display: inline-block; opacity: 0; }
      .gsw.k { color: ${accent}; text-shadow: ${goldGlow}; }
      .gs-top { position: absolute; left: 0; right: 0; top: 13%; display: flex; justify-content: center; }
      .gs-num { position: absolute; left: 4%; right: 4%; top: 36%; text-align: center; font-weight: 820; font-size: ${px(0.12)}px; line-height: 1; letter-spacing: -0.01em; color: ${accent}; text-shadow: 0 0 0.08em ${hexA(accent, 0.75)}, 0 0 0.35em ${hexA(accent, 0.35)}; font-variant-numeric: tabular-nums; }
      .gst-number .gs-label { top: 52%; }
      .gs-num-meter { top: 26%; }
      .gs-bar { position: absolute; left: 12%; right: 12%; top: 44%; height: ${px(0.024)}px; border-radius: 999px; background: ${hexA(text, 0.12)}; box-shadow: inset 0 0 0 2px ${hexA(accent, 0.35)}; overflow: hidden; }
      .gs-fill { height: 100%; border-radius: 999px; background: linear-gradient(90deg, ${hexA(accent, 0.75)}, ${accent}); box-shadow: 0 0 30px ${hexA(accent, 0.6)}; transform-origin: 0 50%; }
      .gs-label-meter { top: 52%; }
      .gs-list { position: absolute; left: 9%; right: 6%; top: 14%; bottom: 20%; display: flex; flex-direction: column; justify-content: center; gap: 3.5%; }
      .gs-row { display: flex; align-items: center; gap: 6%; opacity: 0; }
      .gs-row-label { font-weight: 760; font-size: ${px(0.05)}px; line-height: 1.08; text-transform: uppercase; letter-spacing: 0.012em; text-shadow: ${glow}; }
      .gs-steps { position: absolute; left: 14%; right: 8%; top: 20%; bottom: 24%; display: flex; flex-direction: column; justify-content: space-around; }
      .gs-line { position: absolute; left: ${px(0.036)}px; top: 8%; bottom: 8%; width: 6px; margin-left: -3px; background: linear-gradient(${accent}, ${hexA(accent, 0.4)}); transform-origin: 50% 0; box-shadow: 0 0 20px ${hexA(accent, 0.5)}; }
      .gs-step { position: relative; display: flex; align-items: center; gap: 7%; opacity: 0; }
      .gs-node { flex: 0 0 ${px(0.072)}px; height: ${px(0.072)}px; border-radius: 50%; display: grid; place-items: center; background: ${bg}; border: 5px solid ${accent}; color: ${accent}; font-weight: 820; font-size: ${px(0.036)}px; box-shadow: 0 0 30px ${hexA(accent, 0.5)}; }
      .gs-vs { position: absolute; left: 4%; right: 4%; top: 26%; display: flex; align-items: flex-start; justify-content: space-between; }
      .gs-vs-side { position: relative; flex: 0 0 42%; display: flex; flex-direction: column; align-items: center; gap: 4%; opacity: 0; }
      .gs-vs-label { text-align: center; font-weight: 760; font-size: ${px(0.04)}px; line-height: 1.1; text-transform: uppercase; text-shadow: ${glow}; }
      .gs-vs-r .gs-vs-label { color: ${accent}; text-shadow: ${goldGlow}; }
      .gs-vs-mid { align-self: center; margin-top: -8%; font-weight: 820; font-size: ${px(0.03)}px; color: ${hexA(text, 0.55)}; letter-spacing: 0.1em; }
      .gs-badge { position: absolute; right: 4%; top: -4%; opacity: 0; }
      .gs-phone { position: absolute; left: 19%; right: 19%; top: 17%; height: 58%; border-radius: ${Math.round(W * 0.07)}px; background: linear-gradient(160deg, #1c1a16, ${bg}); border: 6px solid ${hexA(accent, 0.85)}; box-shadow: 0 40px 90px rgba(0,0,0,0.7), 0 0 60px ${hexA(accent, 0.25)}; }
      .gs-phone-notch { position: absolute; left: 36%; right: 36%; top: 3%; height: 3.2%; border-radius: 999px; background: #000; }
      .gs-who { position: absolute; left: 9%; top: 11%; font-weight: 700; font-size: ${px(0.022)}px; letter-spacing: 0.14em; text-transform: uppercase; color: ${accent}; }
      .gs-bubble { position: absolute; left: 8%; right: 10%; top: 18%; padding: 0.5em 0.7em; border-radius: 0.7em 0.7em 0.7em 0.15em; background: ${text}; color: #111; font-weight: 620; font-size: ${px(0.032)}px; line-height: 1.24; opacity: 0; box-shadow: 0 16px 40px rgba(0,0,0,0.5); }
      .gs-bubble .gsw { text-shadow: none; }
      .gs-people { position: absolute; left: 8%; right: 8%; top: 22%; display: flex; flex-wrap: wrap; justify-content: center; gap: 2% 1%; }
      .gs-person { opacity: 0; }
      .gs-label-people { top: 60%; }
      .glow-over { position: absolute; opacity: 0; pointer-events: none; font-family: "Inter", sans-serif; }
      .go-card { display: flex; align-items: center; gap: 0.6em; padding: 0.55em 0.8em; border-radius: 0.6em; background: ${hexA(bg, 0.8)}; border-left: 6px solid ${accent}; box-shadow: 0 18px 50px rgba(0,0,0,0.55); backdrop-filter: blur(10px); font-size: ${px(0.026)}px; }
      .go-icon { flex: 0 0 2.6em; width: 2.6em; height: 2.6em; object-fit: contain; }
      .go-who { font-weight: 700; font-size: 0.72em; letter-spacing: 0.14em; text-transform: uppercase; color: ${accent}; }
      .go-text { color: ${text}; font-weight: 600; line-height: 1.22; }
      .go-text .gsw { text-shadow: none; }
      .go-stamp span { display: inline-block; font-weight: 840; font-size: ${px(0.075)}px; line-height: 1; text-transform: uppercase; letter-spacing: 0.01em; color: ${accent}; text-shadow: 0 0 0.08em ${hexA(accent, 0.8)}, 0 0 0.35em ${hexA(accent, 0.4)}, 0 0.04em 0.25em rgba(0,0,0,0.7); transform-origin: 0 50%; }`;
}

/** The runtime plan's view of each scene and overlay: only timing and counts. */
export function glowRuntime(scenes, overlays) {
  const nums = (s) => { const n = splitNumber(s.value); return n ? { num: n } : {}; };
  return {
    glowScenes: scenes.map((s) => ({ type: s.type || "icons", start: s.start, end: s.end, words: (s.words || []).map((w) => w.start), label: (s.labelWords || []).length, icons: (s.icons || []).filter((icon) => icon.image).length, items: (s.items || []).map((it) => it.at), at: s.left ? [s.left.at, s.right.at] : [], count: s.count || 0, ...(s.type === "number" || s.type === "meter" ? nums(s) : {}), hasIcon: !!s.icon?.image })),
    glowOverlays: overlays.map((o) => ({ type: o.type, start: o.start, end: o.end, words: (o.words || []).map((w) => w.start) })),
  };
}

export const GLOW_SCENES_JS = `
        // Glow scenes: the ground fades in; each type brings its pieces in on the spoken words; everything fades out.
        const gsWords = (i, list, from) => list.forEach((t, j) => tl.fromTo("#gs-" + i + "-w" + j, { opacity: 0, y: 10, filter: "blur(10px)" }, { opacity: 1, y: 0, filter: "blur(0px)", duration: 0.18, ease: "power2.out", immediateRender: false }, Math.max(from, t - 0.03)));
        const gsLabel = (i, n, at) => { for (let j = 0; j < n; j++) tl.fromTo("#gs-" + i + "-w" + j, { opacity: 0, y: 10 }, { opacity: 1, y: 0, duration: 0.2, ease: "power2.out", immediateRender: false }, at + j * 0.06); };
        const gsPop = (sel, at, k) => tl.fromTo(sel, { opacity: 0, scale: 0.7, y: 40 }, { opacity: 1, scale: 1, y: 0, duration: 0.32, ease: "back.out(1.6)", immediateRender: false }, at);
        const gsCount = (sel, n, at, dur) => {
          const el = document.querySelector(sel);
          if (!el || !n) return;
          const fmt = (v) => { const s = v.toFixed(n.decimals); return n.prefix + (n.comma ? Number(s).toLocaleString("en-US", { minimumFractionDigits: n.decimals, maximumFractionDigits: n.decimals }) : s) + n.suffix; };
          const o = { v: 0 };
          tl.fromTo(o, { v: 0 }, { v: n.value, duration: dur, ease: "power2.out", immediateRender: false, onUpdate: () => { el.textContent = fmt(o.v); } }, at);
        };
        (PLAN.glowScenes || []).forEach((s, i) => {
          const el = document.getElementById("gscene-" + i);
          const t0 = s.start + 0.08;
          tl.fromTo(el, { opacity: 0 }, { opacity: 1, duration: 0.1, ease: "power2.out", immediateRender: false }, s.start);
          if (s.type === "number") {
            if (s.hasIcon) gsPop("#gs-" + i + "-i0", t0, 0);
            tl.fromTo("#gs-" + i + "-num", { opacity: 0, scale: 0.6 }, { opacity: 1, scale: 1, duration: 0.3, ease: "back.out(1.7)", immediateRender: false }, t0 + 0.05);
            gsCount("#gs-" + i + "-num", s.num, t0 + 0.05, Math.min(0.9, Math.max(0.4, s.end - t0 - 0.6)));
            gsLabel(i, s.label, t0 + 0.35);
          } else if (s.type === "meter") {
            tl.fromTo("#gs-" + i + "-num", { opacity: 0 }, { opacity: 1, duration: 0.2, immediateRender: false }, t0);
            tl.fromTo("#gs-" + i + "-fill", { scaleX: 0 }, { scaleX: 1, duration: 0.9, ease: "power2.out", immediateRender: false }, t0 + 0.1);
            gsCount("#gs-" + i + "-num", s.num, t0 + 0.1, 0.9);
            gsLabel(i, s.label, t0 + 0.3);
          } else if (s.type === "list" || s.type === "steps") {
            if (s.type === "steps") tl.fromTo("#gs-" + i + "-line", { scaleY: 0 }, { scaleY: 1, duration: Math.max(0.4, (s.items[s.items.length - 1] || t0) - t0 + 0.3), ease: "none", immediateRender: false }, t0);
            // The first row is there as the scene opens (never an empty ground); the rest land on their words.
            s.items.forEach((t, k) => tl.fromTo("#gs-" + i + "-r" + k, { opacity: 0, x: -50 }, { opacity: 1, x: 0, duration: 0.28, ease: "power3.out", immediateRender: false }, k ? Math.max(t0 + k * 0.12, t - 0.05) : t0));
          } else if (s.type === "versus") {
            // Both sides are there from the start (the better one waiting, dim); it lights up when it is said.
            tl.fromTo("#gs-" + i + "-l", { opacity: 0, x: -60 }, { opacity: 1, x: 0, duration: 0.3, ease: "power3.out", immediateRender: false }, t0);
            tl.fromTo("#gs-" + i + "-r", { opacity: 0, x: 60 }, { opacity: 0.3, x: 0, duration: 0.3, ease: "power3.out", immediateRender: false }, t0 + 0.08);
            const rAt = Math.max(t0 + 0.35, s.at[1] - 0.05);
            tl.fromTo("#gs-" + i + "-r", { opacity: 0.3, scale: 1 }, { opacity: 1, scale: 1.06, duration: 0.25, ease: "power2.out", immediateRender: false }, rAt);
            tl.to("#gs-" + i + "-l", { opacity: 0.38, duration: 0.25, immediateRender: false }, rAt + 0.2);
            gsPop("#gs-" + i + "-lb", rAt + 0.2, 0);
            gsPop("#gs-" + i + "-rb", rAt + 0.3, 1);
          } else if (s.type === "quote") {
            tl.fromTo("#gs-" + i + "-bubble", { opacity: 0, y: 30, scale: 0.92 }, { opacity: 1, y: 0, scale: 1, duration: 0.25, ease: "back.out(1.5)", immediateRender: false }, t0);
            s.words.forEach((t, j) => tl.fromTo("#gs-" + i + "-w" + j, { opacity: 0 }, { opacity: 1, duration: 0.08, ease: "none", immediateRender: false }, Math.max(t0 + 0.1, t - 0.02)));
          } else if (s.type === "people") {
            for (let k = 0; k < s.count; k++) gsPop("#gs-" + i + "-p" + k, t0 + k * Math.min(0.12, 0.8 / s.count), k);
            gsLabel(i, s.label, t0 + 0.3);
          } else {
            for (let k = 0; k < s.icons; k++) {
              const at = t0 + k * Math.min(0.35, (s.end - s.start - 0.6) / Math.max(1, s.icons));
              gsPop("#gs-" + i + "-i" + k, at, k);
              tl.to("#gs-" + i + "-i" + k, { y: k % 2 ? 10 : -10, duration: Math.max(0.3, s.end - at - 0.5), ease: "sine.inOut", immediateRender: false }, at + 0.32);
            }
            gsWords(i, s.words, s.start + 0.1);
          }
          tl.to(el, { opacity: 0, duration: 0.16, ease: "power2.in" }, s.end - 0.16);
        });
        (PLAN.glowOverlays || []).forEach((o, i) => {
          const el = document.getElementById("gover-" + i);
          tl.set(el, { opacity: 1 }, o.start);
          if (o.type === "stamp") {
            tl.fromTo("#go-" + i + "-word", { opacity: 0, scale: 1.5, filter: "blur(12px)" }, { opacity: 1, scale: 1, filter: "blur(0px)", duration: 0.22, ease: "power3.out", immediateRender: false }, o.start);
          } else {
            tl.fromTo("#go-" + i + "-card", { opacity: 0, x: -60 }, { opacity: 1, x: 0, duration: 0.28, ease: "power3.out", immediateRender: false }, o.start);
            o.words.forEach((t, j) => tl.fromTo("#go-" + i + "-w" + j, { opacity: 0 }, { opacity: 1, duration: 0.08, ease: "none", immediateRender: false }, Math.max(o.start + 0.1, t - 0.02)));
          }
          tl.to(el, { opacity: 0, duration: 0.16, ease: "power2.in" }, o.end - 0.16);
          tl.set(el, { opacity: 0 }, o.end);
        });
`;
