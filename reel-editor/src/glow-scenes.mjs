/**
 * Glow display elements: the full-screen scenes (on the brand's dark ground) and the band overlays (over the speaker)
 * of the glow look. Each element type has markup, styles and a timeline; the plan says what to show and when.
 *
 * Scenes: icons, number, meter, list, steps, versus, quote, people, flow, thread, bars. Overlays: notify, stamp.
 * Icon images are already copied into the project (icon.image); words carry their spoken start times.
 */

const r3 = (x) => Math.round(x * 1000) / 1000;
export const GLOW_BRIDGE_DURATION = 0.44;

export function firstGlowIcon(scene) {
  if (scene.type === "steps") return null;
  if (scene.type === "list") return scene.items?.[0]?.icon;
  if (scene.type === "versus") return scene.left?.icon;
  return scene.icon || scene.icons?.[0];
}

const WIPE_DIRECTIONS = ["left", "up", "right"];
// Every inset carries its unit: GSAP pairs the numbers of the two strings, and a unitless "0" end value would make
// every in-between frame an invalid (unitless, non-zero) inset that the browser ignores, so the wipe would not show.
const WIPE_OPEN = "inset(0% 0% 0% 0%)";
const WIPE_CLIPS = {
  left: ["inset(0% 0% 0% 100%)", "inset(0% 100% 0% 0%)"],
  up: ["inset(100% 0% 0% 0%)", "inset(0% 0% 100% 0%)"],
  right: ["inset(0% 100% 0% 0%)", "inset(0% 0% 0% 100%)"],
};

function hexA(hex, a) {
  const h = String(hex || "#000000").replace("#", "");
  const n = parseInt(h.length === 3 ? h.split("").map((c) => c + c).join("") : h.slice(0, 6), 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
}

/** "$9.99" → { prefix "$", value 9.99, decimals 2, suffix "" }; null when there is no number to count. */
export function splitNumber(text) {
  const m = String(text || "").match(/^([^\d]*?)(-?\d[\d,]*(?:\.\d+)?)(.*)$/);
  if (!m) return null;
  const digits = m[2].replace(/,/g, "");
  return { prefix: m[1], value: Number(digits), decimals: (digits.split(".")[1] || "").length, comma: m[2].includes(","), suffix: m[3] };
}

const flowNodes = (count) => Array.from({ length: count }, (_, k) => ({ x: 160, y: 140 + k * 720 / (count - 1) }));
const numberScale = (n) => ({ k: 1000, m: 1000000, b: 1000000000 }[n?.suffix.trim().toLowerCase()] || 1);

const img = (icon, id, size, esc, cls = "") => icon?.image ? `<img${id ? ` id="${id}"` : ""} class="gs-img${cls ? ` ${cls}` : ""}" src="${esc(icon.image)}" style="width:${size}px;height:${size}px" alt="">` : "";
const wordsHTML = (words, i, esc, prefix = "gs") => (words || []).map((w, j) => `<span class="gsw${w.key ? " k" : ""}" id="${prefix}-${i}-w${j}">${esc(w.text)}</span>`).join(" ");

function sceneInner(scene, i, { W, H, esc }) {
  const id = (s) => `gs-${i}-${s}`;
  const image = (icon, part, size, cls = "") => img(icon, id(part), size, esc, [cls, Number.isInteger(scene.bridge) && scene.bridge >= 0 && (part === "i0" || part === "p0") ? "gs-bridge-target" : ""].filter(Boolean).join(" "));
  switch (scene.type) {
    case "number": {
      return `${scene.icon ? `<div class="gs-top">${image(scene.icon, "i0", Math.round(W * 0.3))}</div>` : ""}<div class="gs-num" id="${id("num")}">${esc(scene.from ?? scene.value)}</div><div class="gs-label">${wordsHTML(scene.labelWords, i, esc)}</div>`;
    }
    case "meter": {
      return `<div class="gs-num gs-num-meter" id="${id("num")}">${esc(scene.value)}</div><div class="gs-bar"><div class="gs-fill" id="${id("fill")}" style="width:${Math.max(0, Math.min(100, scene.percent))}%"></div></div><div class="gs-label gs-label-meter">${wordsHTML(scene.labelWords, i, esc)}</div>`;
    }
    case "list": {
      const size = Math.round(W * (scene.items.length > 3 ? 0.17 : 0.21));
      return `<div class="gs-list">${scene.items.map((it, k) => `<div class="gs-row" id="${id(`r${k}`)}">${image(it.icon, `i${k}`, size)}<span class="gs-row-label">${esc(it.label)}</span></div>`).join("")}</div>`;
    }
    case "steps": {
      return `<div class="gs-steps"><div class="gs-line" id="${id("line")}"></div>${scene.items.map((it, k) => `<div class="gs-step" id="${id(`r${k}`)}"><span class="gs-node">${k + 1}</span><span class="gs-row-label">${esc(it.label)}</span></div>`).join("")}</div>`;
    }
    case "flow": {
      const nodes = flowNodes(scene.items.length);
      const path = nodes.map((p, k) => `${k ? "L" : "M"}${p.x} ${p.y}`).join(" ");
      const branchY = (nodes[0].y + nodes[1].y) / 2;
      return `<div class="gs-flow"><svg class="gs-flow-svg" viewBox="0 0 800 1000" preserveAspectRatio="none"><path class="gs-flow-path" id="${id("path")}" d="${path}"/>${scene.branch ? `<path class="gs-flow-branch-path" id="${id("bpath")}" d="M160 ${branchY} H440"/>` : ""}</svg>${scene.items.map((it, k) => `<div class="gs-flow-row" id="${id(`r${k}`)}" style="top:${nodes[k].y / 10}%"><span class="gs-flow-dot">${img(it.icon, "", Math.round(W * 0.085), esc)}</span><span>${esc(it.label)}</span></div>`).join("")}${scene.branch ? `<div class="gs-flow-branch" id="${id("branch")}" style="top:${branchY / 10}%">${esc(scene.branch.label)}</div>` : ""}<svg class="gs-flow-svg gs-flow-token-layer" viewBox="0 0 800 1000" preserveAspectRatio="none"><circle class="gs-flow-token" id="${id("token")}" cx="160" cy="140" r="16"/></svg></div>`;
    }
    case "thread": {
      return `<div class="gs-thread"><div class="gs-thread-head"><span>${esc(scene.who)}</span><span class="gs-illustrative">ILLUSTRATIVE</span></div><div class="gs-thread-window">${scene.bubbles.map((b, k) => `<div class="gs-thread-bubble gs-thread-${b.side}" id="${id(`b${k}`)}">${b.words.map((w) => esc(w.text)).join(" ")}</div><div class="gs-typing gs-thread-${b.side}" id="${id(`typing${k}`)}" aria-label="Typing"><span></span><span></span><span></span></div>`).join("")}</div></div>`;
    }
    case "bars": {
      const max = Math.max(scene.left.amount, scene.right.amount);
      const side = (b, k) => `<div class="gs-bars-side gs-bars-${k}" id="${id(k)}"><div class="gs-bars-plot"><div class="gs-bars-fill" id="${id(`${k}fill`)}" style="height:${r3(b.amount / max * 100)}%"></div><span class="gs-bars-value" id="${id(`${k}num`)}" style="bottom:${r3(b.amount / max * 100)}%">${esc(b.value.replace(/-?\d[\d,]*(?:\.\d+)?/, "0"))}</span></div><div class="gs-bars-label">${esc(b.label)}</div></div>`;
      return `<div class="gs-bars">${side(scene.left, "l")}${side(scene.right, "r")}</div>`;
    }
    case "versus": {
      const size = Math.round(W * 0.34);
      // A label's longest word must fit its column (42% of the width): long single words get a smaller size.
      const fit = (label) => Math.round(Math.min(0.04 * H, (0.42 * W * 0.92) / (Math.max(...String(label).split(/\s+/).map((w) => w.length), 1) * 0.68)));
      const side = (s, k, badge) => `<div class="gs-vs-side gs-vs-${k}" id="${id(k)}">${image(s.icon, k === "l" ? "i0" : "i1", size)}<span class="gs-vs-label" style="font-size:${fit(s.label)}px">${esc(s.label)}</span>${badge ? `<div class="gs-badge" id="${id(`${k}b`)}">${img(badge, "", Math.round(W * 0.11), esc)}</div>` : ""}</div>`;
      return `<div class="gs-vs">${side(scene.left, "l", scene.cross)}<div class="gs-vs-mid">VS</div>${side(scene.right, "r", scene.check)}</div>`;
    }
    case "quote": {
      return `<div class="gs-phone"><div class="gs-phone-notch"></div><div class="gs-who">${esc(scene.who)}</div><div class="gs-bubble" id="${id("bubble")}">${wordsHTML(scene.words, i, esc)}</div></div>`;
    }
    case "people": {
      const per = Math.min(5, scene.count);
      const size = Math.round((W * 0.84) / per * 0.86);
      return `<div class="gs-people">${Array.from({ length: scene.count }, (_, k) => image(scene.icon, `p${k}`, size, "gs-person")).join("")}</div><div class="gs-label gs-label-people">${wordsHTML(scene.labelWords, i, esc)}</div>`;
    }
    default: {
      const icons = (scene.icons || []).filter((icon) => icon.image);
      const size = Math.round(W * (icons.length === 1 ? 0.5 : icons.length === 2 ? 0.38 : 0.29));
      return `<div class="gs-icons">${icons.map((icon, k) => image(icon, `i${k}`, size)).join("")}</div><div class="gs-text">${wordsHTML(scene.words, i, esc)}</div>`;
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
      .gs-bridge-target { opacity: 0; }
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
      .gs-flow { position: absolute; left: 8%; right: 18%; top: 16%; height: 60%; }
      .gs-flow-svg { position: absolute; inset: 0; width: 100%; height: 100%; overflow: visible; }
      .gs-flow-token-layer { pointer-events: none; }
      .gs-flow-path, .gs-flow-branch-path { fill: none; stroke: ${accent}; stroke-width: 6; }
      .gs-flow-branch-path { opacity: 0; }
      .gs-flow-token { fill: ${accent}; filter: drop-shadow(0 0 12px ${accent}); }
      .gs-flow-row { position: absolute; left: 20%; right: 0; display: flex; align-items: center; gap: 0.6em; transform: translate(-${Math.round(W * 0.055)}px, -50%); opacity: 0.2; font-size: ${px(0.04)}px; line-height: 1.05; font-weight: 760; text-transform: uppercase; letter-spacing: 0.012em; text-shadow: ${glow}; }
      .gs-flow-dot { width: ${Math.round(W * 0.11)}px; height: ${Math.round(W * 0.11)}px; flex: 0 0 ${Math.round(W * 0.11)}px; border: 4px solid ${accent}; box-shadow: 0 0 30px ${hexA(accent, 0.4)}; border-radius: 50%; background: ${bg}; display: grid; place-items: center; }
      .gs-flow-branch { position: absolute; left: 55%; right: 0; padding: 0.3em 0.5em; background: ${bg}; color: ${accent}; opacity: 0; font-size: ${px(0.03)}px; font-weight: 700; text-transform: uppercase; transform: translateY(-50%); }
      .gs-thread { position: absolute; left: 7%; right: 15%; top: 17%; height: 56%; border: 2px solid ${hexA(accent, 0.4)}; border-radius: ${px(0.02)}px; background: ${hexA(bg, 0.85)}; overflow: hidden; }
      .gs-thread-head { position: absolute; top: 0; left: 0; right: 0; padding: 1em; display: flex; justify-content: space-between; align-items: center; color: ${accent}; font-size: ${px(0.026)}px; font-weight: 700; border-bottom: 1px solid ${hexA(accent, 0.25)}; }
      .gs-illustrative { font-size: 0.62em; letter-spacing: 0.13em; color: ${hexA(text, 0.7)}; }
      .gs-thread-window { position: absolute; left: 5%; right: 5%; top: 15%; bottom: 5%; overflow: hidden; }
      .gs-thread-bubble, .gs-typing { position: absolute; bottom: 0; max-width: 88%; padding: 0.65em 0.8em; border-radius: 0.65em; font-size: ${px(0.031)}px; line-height: 1.2; font-weight: 600; color: ${bg}; opacity: 0; overflow-wrap: anywhere; }
      .gs-thread-them { left: 0; background: ${text}; border-bottom-left-radius: 0.15em; }
      .gs-thread-me { right: 0; background: ${accent}; border-bottom-right-radius: 0.15em; }
      .gs-typing { display: flex; gap: 0.2em; align-items: center; height: 0.7em; }
      .gs-typing span { width: 0.16em; height: 0.16em; background: ${bg}; border-radius: 50%; opacity: 0.55; }
      .gs-bars { position: absolute; left: 12%; right: 20%; top: 25%; height: 43%; display: flex; justify-content: space-between; gap: 14%; }
      .gs-bars-side { flex: 1 1 0; min-width: 0; text-align: center; }
      .gs-bars-plot { position: relative; height: 85%; border-bottom: 3px solid ${hexA(text, 0.5)}; }
      .gs-bars-fill { position: absolute; bottom: 0; left: 12%; right: 12%; background: ${hexA(text, 0.45)}; border-radius: 12px 12px 0 0; transform-origin: 50% 100%; }
      .gs-bars-r .gs-bars-fill { background: ${accent}; box-shadow: 0 0 40px ${hexA(accent, 0.25)}; }
      .gs-bars-value { position: absolute; left: -10%; right: -10%; margin-bottom: 0.2em; opacity: 0; font-size: ${px(0.045)}px; line-height: 1; font-weight: 800; font-variant-numeric: tabular-nums; text-shadow: ${glow}; }
      .gs-bars-r .gs-bars-value { color: ${accent}; text-shadow: ${goldGlow}; }
      .gs-bars-label { padding-top: 0.7em; font-size: ${px(0.03)}px; line-height: 1.1; font-weight: 700; text-transform: uppercase; overflow-wrap: anywhere; }
      .glow-over { position: absolute; opacity: 0; pointer-events: none; font-family: "Inter", sans-serif; }
      .go-card { display: flex; align-items: center; gap: 0.6em; padding: 0.55em 0.8em; border-radius: 0.6em; background: ${hexA(bg, 0.8)}; border-left: 6px solid ${accent}; box-shadow: 0 18px 50px rgba(0,0,0,0.55); backdrop-filter: blur(10px); font-size: ${px(0.026)}px; }
      .go-icon { flex: 0 0 2.6em; width: 2.6em; height: 2.6em; object-fit: contain; }
      .go-who { font-weight: 700; font-size: 0.72em; letter-spacing: 0.14em; text-transform: uppercase; color: ${accent}; }
      .go-text { color: ${text}; font-weight: 600; line-height: 1.22; }
      .go-text .gsw { text-shadow: none; }
      .go-stamp span { display: inline-block; font-weight: 840; font-size: ${px(0.075)}px; line-height: 1; text-transform: uppercase; letter-spacing: 0.01em; color: ${accent}; text-shadow: 0 0 0.08em ${hexA(accent, 0.8)}, 0 0 0.35em ${hexA(accent, 0.4)}, 0 0.04em 0.25em rgba(0,0,0,0.7); transform-origin: 0 50%; }`;
}

/** The runtime view carries timing, counts and deterministic scene transitions. */
export function glowRuntime(scenes, overlays) {
  const nums = (s) => {
    const n = splitNumber(s.value), from = splitNumber(s.from);
    return n ? { num: { ...n, ...(from ? { from: from.value * numberScale(from) / numberScale(n) } : {}) } } : {};
  };
  return {
    glowScenes: scenes.map((s, i) => {
      const direction = WIPE_DIRECTIONS[i % WIPE_DIRECTIONS.length];
      const [enter, exit] = WIPE_CLIPS[direction];
      const bridge = Number.isInteger(s.bridge) && s.bridge >= 0 && firstGlowIcon(s)?.image
        ? { bridge: s.bridge, bridgeDuration: GLOW_BRIDGE_DURATION, bridgeTarget: `#gs-${i}-${s.type === "people" ? "p0" : "i0"}` } : {};
      return { type: s.type || "icons", start: s.start, end: s.end, words: (s.words || []).map((w) => w.start), label: (s.labelWords || []).length, icons: (s.icons || []).filter((icon) => icon.image).length, items: (s.items || []).map((it) => it.at), at: s.left ? [s.left.at, s.right.at] : [], count: s.count || 0, ...(s.type === "number" || s.type === "meter" ? nums(s) : {}), hasIcon: !!s.icon?.image, ...(s.type === "flow" ? { nodes: flowNodes(s.items.length), branch: s.branch?.at ?? null } : {}), ...(s.type === "thread" ? { bubbles: s.bubbles.map((b) => ({ side: b.side, at: b.at, words: b.words.map((w) => w.start) })) } : {}), ...(s.type === "bars" ? { bars: [s.left, s.right].map((b) => ({ at: b.at, amount: b.amount, ...nums(b) })) } : {}), wipe: { direction, enter, exit, open: WIPE_OPEN, duration: 0.22 }, ...bridge };
    }),
    glowOverlays: overlays.map((o) => ({ type: o.type, start: o.start, end: o.end, words: (o.words || []).map((w) => w.start) })),
  };
}

export const GLOW_SCENES_JS = `
        // Glow scenes: the ground wipes in; each type brings its pieces in on the spoken words.
        const gsWords = (i, list, from) => list.forEach((t, j) => tl.fromTo("#gs-" + i + "-w" + j, { opacity: 0, y: 10, filter: "blur(10px)" }, { opacity: 1, y: 0, filter: "blur(0px)", duration: 0.18, ease: "power2.out", immediateRender: false }, Math.max(from, t - 0.03)));
        const gsLabel = (i, n, at) => { for (let j = 0; j < n; j++) tl.fromTo("#gs-" + i + "-w" + j, { opacity: 0, y: 10 }, { opacity: 1, y: 0, duration: 0.2, ease: "power2.out", immediateRender: false }, at + j * 0.06); };
        const gsPop = (sel, at, k) => tl.fromTo(sel, { opacity: 0, scale: 0.7, y: 40 }, { opacity: 1, scale: 1, y: 0, duration: 0.32, ease: "back.out(1.6)", immediateRender: false }, at);
        const gsCount = (sel, n, at, dur, from = 0) => {
          const el = document.querySelector(sel);
          if (!el || !n) return;
          const fmt = (v) => { const s = v.toFixed(n.decimals); return n.prefix + (n.comma ? Number(s).toLocaleString("en-US", { minimumFractionDigits: n.decimals, maximumFractionDigits: n.decimals }) : s) + n.suffix; };
          const o = { v: from };
          tl.fromTo(o, { v: from }, { v: n.value, duration: dur, ease: "power2.out", immediateRender: false, onUpdate: () => { el.textContent = fmt(o.v); } }, at);
        };
        const gsBridge = (s) => {
          if (!Number.isInteger(s.bridge) || !PLAN.icons?.[s.bridge]?.action) return false;
          const source = document.getElementById("icon-" + s.bridge);
          const target = document.querySelector(s.bridgeTarget);
          const root = document.getElementById("root");
          if (!source || !target || !root) return false;
          // The timeline is built before the renderer sizes the page, when the root can still be 0 px tall (the scene's
          // pieces would then all sit at the top): measure with the root at its full height, then put it back.
          const height = root.style.height;
          if (!root.getBoundingClientRect().height) root.style.height = PLAN.height * (root.getBoundingClientRect().width / PLAN.width || 1) + "px";
          const a = source.querySelector(".icon-disc").getBoundingClientRect(), b = target.getBoundingClientRect();
          const canvas = root.getBoundingClientRect();
          root.style.height = height;
          if (!a.width || !a.height || !b.width || !b.height || !canvas.width || !canvas.height) return false;
          const x = (b.left + b.width / 2 - a.left - a.width / 2) * PLAN.width / canvas.width;
          const y = (b.top + b.height / 2 - a.top - a.height / 2) * PLAN.height / canvas.height;
          const done = s.start + s.bridgeDuration;
          const covered = s.wipe.duration;
          tl.set(source, { zIndex: 4 }, s.start);
          // Travel along the chin band first; only rise and grow once the wipe has covered the face.
          tl.fromTo(source, { x: 0 }, { x, duration: s.bridgeDuration, ease: "power2.inOut", immediateRender: false }, s.start);
          tl.fromTo(source, { y: 0, scaleX: 1, scaleY: 1 }, { y, scaleX: b.width / a.width, scaleY: b.height / a.height, duration: s.bridgeDuration - covered, ease: "power2.inOut", immediateRender: false }, s.start + covered);
          tl.to(source.querySelectorAll(".icon-ghost, .icon-ping, .icon-hit, .icon-shadow"), { opacity: 0, duration: 0.06, immediateRender: false }, s.start);
          tl.fromTo(target, { opacity: 0 }, { opacity: 1, duration: 0.04, ease: "none", immediateRender: false }, done - 0.04);
          tl.fromTo(source, { opacity: 1 }, { opacity: 0, duration: 0.04, ease: "none", immediateRender: false }, done - 0.04);
          tl.set(source, { zIndex: 0 }, done);
          return true;
        };
        (PLAN.glowScenes || []).forEach((s, i) => {
          const el = document.getElementById("gscene-" + i);
          const t0 = s.start + 0.08;
          const bridged = gsBridge(s);
          const pop = (sel, at, k) => { if (!bridged || sel !== s.bridgeTarget) gsPop(sel, at, k); };
          if (!bridged && s.bridgeTarget) tl.fromTo(s.bridgeTarget, { opacity: 0 }, { opacity: 1, duration: 0.1, immediateRender: false }, t0);
          tl.fromTo(el, { clipPath: s.wipe.enter }, { clipPath: s.wipe.open, duration: s.wipe.duration, ease: "power2.out", immediateRender: false }, s.start);
          tl.fromTo(el, { opacity: 0 }, { opacity: 1, duration: 0.1, ease: "power2.out", immediateRender: false }, s.start);
          if (s.type === "number") {
            if (s.hasIcon) pop("#gs-" + i + "-i0", t0, 0);
            tl.fromTo("#gs-" + i + "-num", { opacity: 0, scale: 0.92 }, { opacity: 1, scale: 1, duration: 0.3, ease: "power3.out", immediateRender: false }, s.start);
            if (s.num && s.num.from != null) gsCount("#gs-" + i + "-num", s.num, s.start, Math.min(0.9, Math.max(0.4, s.end - t0 - 0.6)), s.num.from);
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
          } else if (s.type === "flow") {
            const path = document.getElementById("gs-" + i + "-path");
            // Measured once at build; the connector starts hidden and each segment draws as the token travels it, so
            // the line's front and the token stay together on any seek.
            const length = path.getTotalLength();
            const seg = length / Math.max(1, s.items.length - 1);
            path.style.strokeDasharray = length + " " + length;
            path.style.strokeDashoffset = length;
            const token = "#gs-" + i + "-token";
            s.items.forEach((t, k) => {
              tl.fromTo("#gs-" + i + "-r" + k, { opacity: 0.2 }, { opacity: 1, duration: 0.2, ease: "power2.out", immediateRender: false }, k ? t : s.start);
              if (k) {
                const prev = k === 1 ? s.start : s.items[k - 1];
                const dur = Math.max(0.01, t - prev);
                tl.fromTo(token, { attr: { cx: s.nodes[k - 1].x, cy: s.nodes[k - 1].y } }, { attr: { cx: s.nodes[k].x, cy: s.nodes[k].y }, duration: dur, ease: "power1.inOut", immediateRender: false }, prev);
                tl.fromTo(path, { strokeDashoffset: length - (k - 1) * seg }, { strokeDashoffset: length - k * seg, duration: dur, ease: "power1.inOut", immediateRender: false }, prev);
              }
            });
            if (s.branch != null) {
              const bAt = Math.max(s.start, s.branch);
              tl.fromTo("#gs-" + i + "-bpath", { opacity: 0 }, { opacity: 0.3, duration: 0.2, immediateRender: false }, bAt);
              tl.fromTo("#gs-" + i + "-branch", { opacity: 0 }, { opacity: 0.55, duration: 0.2, immediateRender: false }, bAt);
            }
          } else if (s.type === "thread") {
            const bubbleEls = s.bubbles.map((b, k) => document.getElementById("gs-" + i + "-b" + k));
            // Earlier bubbles move up first (0.6 s ahead), the typing dots show in the room for 0.4 s, then the bubble
            // lands; quick replies wait so the moves never overlap.
            let last = -Infinity;
            s.bubbles.forEach((b, k) => {
              const at = last = Math.max(s.start + 0.4, b.at, last + 0.85);
              const typing = "#gs-" + i + "-typing" + k;
              tl.set(typing, { opacity: 1 }, at - 0.4);
              tl.fromTo(typing + " span", { opacity: 0.35 }, { opacity: 0.85, stagger: 0.08, duration: 0.16, ease: "sine.inOut", immediateRender: false }, at - 0.4);
              tl.set(typing, { opacity: 0 }, at);
              tl.fromTo(bubbleEls[k], { opacity: 0, y: 15 }, { opacity: 1, y: 0, duration: 0.2, ease: "power2.out", immediateRender: false }, at);
              // Measure once when building the timeline; explicit offsets keep forward and backward seeks identical.
              for (let j = 0; j < k; j++) {
                const offset = (end) => bubbleEls.slice(j + 1, end + 1).reduce((sum, el) => sum + el.offsetHeight + 22, 0);
                tl.fromTo(bubbleEls[j], { y: -offset(k - 1) }, { y: -offset(k), duration: 0.2, ease: "power2.out", immediateRender: false }, at - 0.6);
              }
            });
          } else if (s.type === "bars") {
            s.bars.forEach((b, k) => {
              const side = k ? "r" : "l";
              const at = k ? Math.max(s.start, b.at) : s.start;
              tl.fromTo("#gs-" + i + "-" + side + "fill", { scaleY: 0 }, { scaleY: 1, duration: 0.65, ease: "power2.out", immediateRender: false }, at);
              tl.fromTo("#gs-" + i + "-" + side + "num", { opacity: 0 }, { opacity: 1, duration: 0.2, immediateRender: false }, at);
              gsCount("#gs-" + i + "-" + side + "num", b.num, at, 0.65);
            });
          } else if (s.type === "versus") {
            // Both sides are there from the start (the better one waiting, dim); it lights up when it is said.
            tl.fromTo("#gs-" + i + "-l", { opacity: 0, x: -60 }, { opacity: 1, x: 0, duration: 0.3, ease: "power3.out", immediateRender: false }, t0);
            tl.fromTo("#gs-" + i + "-r", { opacity: 0, x: 60 }, { opacity: 0.3, x: 0, duration: 0.3, ease: "power3.out", immediateRender: false }, t0 + 0.08);
            const rAt = Math.max(t0 + 0.35, s.at[1] - 0.05);
            tl.fromTo("#gs-" + i + "-r", { opacity: 0.3, scale: 1 }, { opacity: 1, scale: 1.06, duration: 0.25, ease: "power2.out", immediateRender: false }, rAt);
            tl.to("#gs-" + i + "-l", { opacity: 0.38, duration: 0.25, immediateRender: false }, rAt + 0.2);
            pop("#gs-" + i + "-lb", rAt + 0.2, 0);
            pop("#gs-" + i + "-rb", rAt + 0.3, 1);
          } else if (s.type === "quote") {
            tl.fromTo("#gs-" + i + "-bubble", { opacity: 0, y: 30, scale: 0.92 }, { opacity: 1, y: 0, scale: 1, duration: 0.25, ease: "back.out(1.5)", immediateRender: false }, t0);
            s.words.forEach((t, j) => tl.fromTo("#gs-" + i + "-w" + j, { opacity: 0 }, { opacity: 1, duration: 0.08, ease: "none", immediateRender: false }, Math.max(t0 + 0.1, t - 0.02)));
          } else if (s.type === "people") {
            for (let k = 0; k < s.count; k++) pop("#gs-" + i + "-p" + k, t0 + k * Math.min(0.12, 0.8 / s.count), k);
            gsLabel(i, s.label, t0 + 0.3);
          } else {
            for (let k = 0; k < s.icons; k++) {
              const at = t0 + k * Math.min(0.35, (s.end - s.start - 0.6) / Math.max(1, s.icons));
              pop("#gs-" + i + "-i" + k, at, k);
              const floatAt = bridged && !k ? s.start + s.bridgeDuration : at + 0.32;
              tl.to("#gs-" + i + "-i" + k, { y: k % 2 ? 10 : -10, duration: Math.max(0.3, s.end - floatAt - 0.18), ease: "sine.inOut", immediateRender: false }, floatAt);
            }
            gsWords(i, s.words, s.start + 0.1);
          }
          tl.fromTo(el, { clipPath: s.wipe.open }, { clipPath: s.wipe.exit, duration: s.wipe.duration, ease: "power2.in", immediateRender: false }, s.end - s.wipe.duration);
          tl.fromTo(el, { opacity: 1 }, { opacity: 0, duration: 0.16, ease: "power2.in", immediateRender: false }, s.end - 0.16);
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
