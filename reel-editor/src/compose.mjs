import fs from "node:fs";
import path from "node:path";
import { ensureDir, copyOrLink, r3, PKG_ROOT, fontFile, ownDisplay } from "./util.mjs";
import { sceneHTML, graphicsCSS, proofMessageCSS, GRAPHICS_JS, numberMotion, progressHTML, progressCSS, PROGRESS_JS } from "./graphics.mjs";
import { skinsCSS, skinFonts, themeCSS, themeFontSkins, MARKERS, THEMES } from "./looks.mjs";
import { inlineIconSVG } from "./icons.mjs";
import { brandQuietCSS } from "./brandlooks.mjs";
import { tokensCSS } from "./brandtokens.mjs";
import { creditValueGrounded, creditVerifiedGrounded } from "./credentials.mjs";

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
  for (const f of ["Anton-Regular.ttf", "Inter.ttf"]) fs.copyFileSync(fontFile(plan.style, f), path.join(assets, "fonts", f));
  // The brand looks' italic serif (brandlooks.mjs); without it the browser slants the upright face.
  const italic = plan.style?.fonts?.displayItalic;
  if (italic && fs.existsSync(italic)) fs.copyFileSync(italic, path.join(assets, "fonts", "DisplayItalic.ttf"));
  // The fonts the reel's card look needs (typewriter, marker, serif).
  for (const f of skinFonts([...(plan.graphics || []).map((g) => g.skin || "glass"), ...themeFontSkins(THEMES[plan.style?.look] || null)], { display: ownDisplay(plan.style) }).files) fs.copyFileSync(path.join(PKG_ROOT, "assets", "fonts", f), path.join(assets, "fonts", f));
  // Credential plates use the semantic font families. Copy their exact files into the project; the established
  // display/body aliases remain a safe fallback for old client kits whose token file path is no longer present.
  if (plan.lowerThird?.credential && plan.lowerThird.items?.length && plan.style?.brand) {
    const brand = structuredClone(plan.style.brand);
    for (const [role, fallback] of [["display", "Anton-Regular.ttf"], ["body", "Inter.ttf"]]) {
      const spec = brand.type?.[role];
      if (!spec) continue;
      const candidates = spec.file ? [spec.file, path.resolve(PKG_ROOT, spec.file)] : [];
      const source = candidates.find((file) => fs.existsSync(file));
      const ext = path.extname(source || fallback) || ".ttf";
      const name = `credential-${role}${ext}`;
      if (source) fs.copyFileSync(source, path.join(assets, "fonts", name));
      else fs.copyFileSync(path.join(assets, "fonts", fallback), path.join(assets, "fonts", name));
      spec.file = `assets/fonts/${name}`;
    }
    plan.style.brand = brand;
  }
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
  // Window-matched person mattes for pop-out slams and cutout b-roll live beside the hook's alpha clip.
  const extraCutouts = [
    ...(plan.broll || []).map((b, i) => ({ cut: b.cutout, src: `assets/cutouts/broll-${i + 1}.webm` })),
    ...(plan.slams || []).map((sl, i) => ({ cut: sl.popout, src: `assets/cutouts/popout-${i + 1}.webm` })),
  ].filter((x) => x.cut?.file && fs.existsSync(x.cut.file));
  if (extraCutouts.length) ensureDir(path.join(assets, "cutouts"));
  for (const x of extraCutouts) { x.cut.src = x.src; copyOrLink(x.cut.file, path.join(projectDir, x.src)); }
  for (const b of plan.broll || []) if (b.cutout && !b.cutout.src) b.cutout = null;
  for (const sl of plan.slams || []) if (sl.popout && !sl.popout.src) sl.popout = null;
  // Text behind you: the person cutout (VP9 with alpha) for the hook window.
  if (plan.behind?.file && fs.existsSync(plan.behind.file)) {
    plan.behind.src = "assets/cutout.webm";
    copyOrLink(plan.behind.file, path.join(projectDir, plan.behind.src));
  } else if (plan.behind) plan.behind.src = null;
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
  // dimFuture: false shows the whole phrase at full strength and swaps it hard (the niche winners' pattern); the
  // default dims the words not yet spoken.
  const dimFuture = reveal && cap.dimFuture !== false;
  // Hand-drawn marker on the gold word: a squiggle underline, or a loose circle around a number or amount. The
  // stroke draws on as the word is spoken (stroke-dashoffset, measured at runtime).
  const annotate = !!cap.annotate;
  const marker = (w, first) => {
    if (!annotate || !w.key || !first) return "";
    // The look's marker shape (underline, scribble, box, bracket, circle); without a look, a circle for a number and
    // an underline for a word, as always.
    const m = MARKERS[cap.marker] || MARKERS[/\d|\$/.test(w.text) ? "circle" : "underline"];
    return `<svg class="an ${m.cls}" viewBox="${m.box}" preserveAspectRatio="none" aria-hidden="true"><path d="${m.d}"/></svg>`;
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
    ? `<div id="hook-block"><div id="hook-scrim"></div><div id="hook-lines">${hookWordList.map((w) => `<span class="hw${w.key ? " k" : ""}">${esc(w.text)}</span>`).join(" ")}${hk.treat === "type" ? '<span class="hook-cursor"></span>' : ""}</div><div id="hook-bar"></div></div>`
    : `<span id="hook-text">${esc(plan.hook?.text || "")}</span>`;
  const hookHTML = plan.hook
    ? `      <div id="hook" class="clip hook-t-${esc(hk.treat || "headline")}" data-start="${plan.hook.start}" data-duration="${plan.hook.duration}" data-track-index="3" data-layout-allow-overflow>${hookInner}</div>`
    : "";

  const ctaHTML = plan.cta
    ? `      <div id="cta" class="clip" data-start="${plan.cta.start}" data-duration="${plan.cta.duration}" data-track-index="4" data-layout-allow-overflow><span id="cta-text">${esc(plan.cta.text)}</span></div>`
    : "";

  // Text behind you: the person cut out of the same frames (VP9 with alpha) plays over the hook, in a wrap that
  // mirrors every move of the footage wrap, so the headline runs behind the head and shoulders.
  const behind = plan.behind && plan.behind.src ? plan.behind : null;
  const bumps = plan.motion?.bumps || [];
  const drifts = plan.motion?.drift || [];
  const hasImpact = bumps.length > 0;
  const hasDrift = drifts.length > 0;
  // Every cutout (the hook's, a cutout b-roll's, a pop-out's) gets the same inner wraps as the footage, so drift and
  // bumps move the person with the frame; the timeline targets them by class.
  const motionWrap = (inner, cutout = false) => {
    const pre = cutout === true ? "cutout-" : cutout || "";
    if (hasImpact) inner = `<div id="${pre}impact-wrap" class="motion-inner impact-inner">${inner}</div>`;
    if (hasDrift) inner = `<div id="${pre}drift-wrap" class="motion-inner drift-inner">${inner}</div>`;
    return inner;
  };
  const cutoutMedia = behind ? `<video id="cutout" class="clip" src="${esc(behind.src)}" data-start="${behind.start}" data-duration="${behind.duration}" data-track-index="4" muted playsinline></video>` : "";
  const cutoutHTML = behind
    ? `      <div id="cutout-wrap" data-layout-allow-overflow>${motionWrap(cutoutMedia, true)}</div>`
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
  const brollCut = ["flash", "blur", "whip"].includes(s.broll?.cut) ? s.broll.cut : "hard";
  // A still is an <img>; a generated clip (Runway) is a muted <video> that plays from its start while the cut holds.
  const brollMedia = (b) => (b.video
    ? `<video class="broll-media" src="${esc(b.src)}" data-start="${b.start}" data-duration="${b.duration}" data-track-index="2" muted playsinline${grade}${pullStyle}></video>`
    : `<img class="broll-media" src="${esc(b.src)}" alt=""${grade}${pullStyle} />`);
  const brollLayout = (b) => ["window", "split"].includes(b.layout) ? b.layout : "full";
  const sharedBroll = brollList.some((b) => brollLayout(b) !== "full");
  const splitBroll = brollList.some((b) => brollLayout(b) === "split");
  const brollHTML = brollList
    .map((b, i) => {
      const layout = brollLayout(b);
      if (layout === "window") {
        const p = b.panel;
        return `      <div id="broll-${i}" class="broll broll-window clip" style="left:${p.x}px;top:${p.y}px;width:${p.w}px;height:${p.h}px;--broll-radius:${Math.round(p.w * 0.04)}px" data-start="${b.start}" data-duration="${b.duration}" data-track-index="2"><div class="broll-move">${brollMedia(b)}</div><div class="broll-shade"></div></div>`;
      }
      if (layout === "split") return `      <div id="broll-${i}" class="broll broll-split clip" style="height:${b.split?.seamY ?? Math.round(H / 2)}px" data-start="${b.start}" data-duration="${b.duration}" data-track-index="2"><div class="broll-move">${brollMedia(b)}</div><div class="broll-shade"></div><div class="split-divider"></div></div>`;
      return `      <div id="broll-${i}" class="broll clip" data-start="${b.start}" data-duration="${b.duration}" data-track-index="2"><div class="broll-move">${brollMedia(b)}</div><div class="broll-shade"></div>${brollCut === "flash" ? '<div class="broll-flash"><div class="broll-flash-core"></div></div>' : ""}</div>`;
    })
    .join("\n");
  // A real directional blur for whip cuts. Chromium's SVG filter is seek-stable and `stdDeviation="x 0"` blurs
  // only horizontally; animating the attribute avoids frame-history tricks whose result depends on render order.
  const whip = brollCut === "whip" && brollList.length > 0;
  const whipFiltersHTML = whip
    ? `      <svg id="whip-filters" width="0" height="0" aria-hidden="true"><defs><filter id="whip-foot-filter" x="-25%" y="-5%" width="150%" height="110%"><feGaussianBlur id="whip-foot-blur" stdDeviation="0 0" edgeMode="duplicate" /></filter>${brollList.map((_, i) => `<filter id="whip-broll-filter-${i}" x="-25%" y="-5%" width="150%" height="110%"><feGaussianBlur id="whip-broll-blur-${i}" stdDeviation="0 0" edgeMode="duplicate" /></filter>`).join("")}</defs></svg>\n`
    : "";
  const brollCutoutHTML = brollList
    .map((b, i) => b.cutout?.src ? `      <div id="broll-cutout-wrap-${i}" class="cutout-wrap broll-cutout-wrap" data-layout-allow-overflow>${motionWrap(`<video id="broll-cutout-${i}" class="clip cutout-person broll-cutout-person" style="--cutout-outline:${r3(W * 0.004)}px" src="${esc(b.cutout.src)}" data-start="${b.cutout.start}" data-duration="${b.cutout.duration}" data-track-index="4" muted playsinline></video>`, `broll-cutout-${i}-`)}</div>` : "")
    .filter(Boolean)
    .join("\n");

  // Cold open: the strongest still under the hook for the first beat, then a flash into the speaker.
  const open = plan.coldOpen && plan.coldOpen.src ? plan.coldOpen : null;
  const openHTML = open
    ? `      <div id="cold-open" class="broll clip" data-start="0" data-duration="${open.duration}" data-track-index="2"><div class="broll-move"><img src="${esc(open.src)}" alt=""${grade} /></div><div class="broll-shade"></div></div>
      <div id="open-flash" class="clip" data-start="0" data-duration="${r3(open.duration + 0.5)}" data-track-index="5" data-layout-allow-overflow><div class="broll-flash"></div><div class="broll-flash-core"></div></div>`
    : "";

  // Lower third: the name and handle once, early in the first chapter (long-form).
  const lt = plan.lowerThird;
  const rawCredentialItems = lt?.credential && Array.isArray(lt.items) ? lt.items : [];
  const grounded = (item, key) => (item.input?.kind === "cli" || item.input?.kind === "brand.identity") && creditValueGrounded(item, key);
  const credentialItems = rawCredentialItems.filter((item) => item.name && grounded(item, "name") && [item.placement?.x, item.placement?.y, item.placement?.w, item.placement?.h].every(Number.isFinite));
  const credentialMode = credentialItems.length > 0;
  const credentialHTML = credentialItems.map((item, i) => {
    const p = item.placement;
    const verified = creditVerifiedGrounded(item) ? `<span class="lt-verified" aria-label="Verified"><svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="9"></circle><path d="m8 12 2.5 2.5L16 9"></path></svg></span>` : "";
    return `      <div id="credential-lower-third-${i}" class="credential-lower-third clip" style="--lt-x:${p.x}px;--lt-y:${p.y}px;--lt-w:${p.w}px;--lt-h:${p.h}px" data-start="${item.at}" data-duration="${item.duration}" data-track-index="3" data-layout-allow-overflow><div class="lt-plate"><div class="lt-rule"></div><div class="lt-copy"><div class="lt-name-row"><div class="lt-name">${esc(item.name)}</div>${verified}</div>${grounded(item, "credential") ? `<div class="lt-credential">${esc(item.credential)}</div>` : ""}${grounded(item, "organisation") ? `<div class="lt-organisation">${esc(item.organisation)}</div>` : ""}${grounded(item, "source") ? `<div class="lt-source">${esc(item.source)}</div>` : ""}</div></div></div>`;
  }).join("\n");
  const lowerHTML = credentialMode
    ? credentialHTML
    : lt && lt.name
    ? `      <div id="lower-third" class="clip" data-start="${lt.at}" data-duration="${lt.duration}" data-track-index="3" data-layout-allow-overflow><div class="lt-bar"></div><div class="lt-text"><div class="lt-name">${esc(lt.name)}</div>${lt.handle ? `<div class="lt-handle">${esc(lt.handle)}</div>` : ""}</div></div>`
    : "";

  // Climax words: a gold word stamps in big in the top third as it is said.
  const slamList = plan.slams || [];
  const slamFont = (t) => Math.round(Math.min(0.115 * H, (0.86 * W) / Math.max(3, t.length * 0.52)));
  const slamHTML = slamList
    .map((sl, i) => {
      const p = sl.popout?.src ? sl.popout : null;
      const stage = p ? ` style="left:${r3((76 / 1080) * 100)}%;right:${r3(((1080 - 940) / 1080) * 100)}%;top:${p.placement.top}px;height:${Math.round(p.placement.fontSize * 1.05)}px"` : "";
      return `      <div id="slam-${i}" class="slam clip${p ? " slam-popout" : ""}${p?.placement?.fallback ? " slam-front" : ""}" data-start="${sl.t}" data-duration="${r3(sl.end - sl.t)}" data-track-index="3" data-layout-allow-overflow><div class="slam-stage"${stage}><div class="slam-word slam-t-${esc(s.slams?.style || "slam")}" style="font-size:${p?.placement.fontSize || slamFont(sl.text)}px">${esc(sl.text)}</div></div></div>`;
    })
    .join("\n");
  const popoutBgHTML = slamList
    .map((sl, i) => sl.popout?.src ? `      <div id="popout-bg-${i}" class="popout-bg clip" style="background:radial-gradient(ellipse 46% 31% at 50% 45%, ${hexA(c.accent, 0.48)} 0%, ${hexA(c.accent, 0)} 72%),linear-gradient(${hexA(c.bg, sl.popout.dim ?? 0.62)},${hexA(c.bg, sl.popout.dim ?? 0.62)})" data-start="${sl.t}" data-duration="${r3(sl.end - sl.t)}" data-track-index="1" data-layout-allow-overflow></div>` : "")
    .filter(Boolean)
    .join("\n");
  const popoutCutoutHTML = slamList
    .map((sl, i) => sl.popout?.src ? `      <div id="popout-cutout-wrap-${i}" class="cutout-wrap popout-cutout-wrap" data-layout-allow-overflow>${motionWrap(`<video id="popout-cutout-${i}" class="clip cutout-person popout-cutout-person" style="--cutout-outline:${r3(W * (sl.popout.outline ?? 0.004))}px" src="${esc(sl.popout.src)}" data-start="${sl.popout.start}" data-duration="${sl.popout.duration}" data-track-index="4" muted playsinline></video>`, `popout-cutout-${i}-`)}</div>` : "")
    .filter(Boolean)
    .join("\n");

  // Spoken icon pops: the plan already chose the word, timing and face-safe square; compose only draws it.
  const iconList = (plan.icons || []).map((icon) => ({ ...icon, svg: inlineIconSVG(icon.icon) })).filter((icon) => icon.svg);
  const iconSkin = s.icons?.skin === "glass" ? "glass" : "disc";
  const iconHTML = iconList
    .map((icon, i) => `      <div id="icon-${i}" class="icon-pop icon-${iconSkin} clip" style="left:${icon.x}px;top:${icon.y}px;width:${icon.size}px;height:${icon.size}px" data-start="${icon.t}" data-duration="${r3(icon.end - icon.t)}" data-track-index="3" data-layout-allow-overflow aria-label="${esc(icon.word)}"><div class="icon-disc">${icon.svg}</div></div>`)
    .join("\n");

  // Graphic scenes: designed full-screen cards over the footage, under the captions.
  const gfxList = plan.graphics || [];
  const gfxSchema = plan.graphicsSchema ?? gfxList.schema ?? 1;
  const progressList = gfxList.filter((g) => g.type === "progress" && g.placement && !g.placement.skip);
  const cardList = gfxList.some((g) => g.type === "progress") ? gfxList.filter((g) => g.type !== "progress") : gfxList;
  // Looks (looks.mjs) restyle the overlay cards; the YouTube band layout keeps the glass cards.
  const gfxMode = s.graphics?.mode || "overlay";
  const faceSide = plan.framing?.side === "left" ? "right" : "left";
  const skinned = (g) => ({ ...(gfxMode === "overlay" ? g : { ...g, skin: "glass" }), faceSide });
  const timed = (g) => (g.type === "list" || g.type === "steps") && g.items?.length && g.items.every((it) => Number.isFinite(it.at));
  const hasProof = cardList.some((g) => g.type === "message" && g.mode === "proof");
  const gfxHTML = cardList.map((g, i) => `      <div id="gfx-${i}" class="gfx clip gfx-${g.type}${timed(g) ? " gfx-timed" : ""}${g.type === "message" && g.mode === "proof" ? " gfx-message-proof" : ""} skin-${skinned(g).skin || "glass"}" data-start="${g.start}" data-duration="${g.duration}" data-track-index="2">${sceneHTML(skinned(g), { schema: gfxSchema })}</div>`).join("\n");
  const progressRailHTML = progressList.map((g, i) => {
    const p = g.placement;
    return `      <div id="progress-${i}" class="progress clip ${p.orientation === "vertical" ? "vertical" : "horizontal"} skin-${g.skin || "glass"}" style="left:${p.x}px;top:${p.y}px;width:${p.w}px;height:${p.h}px" data-start="${g.start}" data-duration="${g.duration}" data-track-index="3" data-layout-allow-overflow>${progressHTML(g)}</div>`;
  }).join("\n");
  const skinsUsed = [...new Set(gfxList.map((g) => skinned(g).skin || "glass"))];
  const theme = THEMES[s.look] || null;
  // A preset on the brand looks also gets the quiet house pieces (phone labels, name tag) and the brand fonts for them.
  const brandQuiet = (s.graphics?.includeLooks || []).length > 0;
  const fontsForSkins = skinFonts([...skinsUsed, ...themeFontSkins(theme), ...(brandQuiet ? ["atelier"] : [])], { display: ownDisplay(s) });

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
  const footageMedia = `<video id="footage" src="${footage}" data-start="0" data-duration="${D}" data-track-index="0"${videoAudio} playsinline></video>`;
  const videoWrapHTML = `      <div id="video-wrap" data-layout-allow-overflow>\n        ${motionWrap(footageMedia)}\n      </div>`;
  // Split b-roll moves the whole footage (with its zoom wrap) into the bottom half; the whip slides all of it sideways.
  const splitWrapHTML = splitBroll ? `      <div id="footage-layout" data-layout-allow-overflow><div id="footage-position" data-layout-allow-overflow>\n${videoWrapHTML}\n      </div></div>` : videoWrapHTML;
  const videoLayerHTML = whip ? `      <div id="whip-wrap" data-layout-allow-overflow>\n${splitWrapHTML}\n      </div>` : splitWrapHTML;

  const runtimePlan = {
    duration: D,
    hook: plan.hook ? { start: plan.hook.start, duration: plan.hook.duration, style: hookStyle, font: hookFont, treat: hk.treat || "headline", ...(Number.isFinite(plan.hook.headTop) && !behind ? { headTop: plan.hook.headTop, headBottom: plan.hook.headBottom ?? 1 } : {}) } : null,
    cta: plan.cta ? { start: plan.cta.start, duration: plan.cta.duration } : null,
    captions: captions.map((g) => ({ start: g.start, end: g.end, words: g.words.map((w) => [w.start, w.end]) })),
    activeWord: !!cap.activeWord,
    zooms: plan.zooms || [],
    broll: brollList.map((b, i) => {
      const layout = brollLayout(b);
      return { start: b.start, duration: b.duration, motion: b.video ? "none" : b.motion || "in", video: !!b.video, ...(b.cutout?.src ? { cutout: i } : {}), ...(layout !== "full" ? { layout, ...(layout === "split" ? { footageY: b.split.footageY, seamY: b.split.seamY ?? Math.round(H / 2) } : {}) } : {}) };
    }),
    graphics: cardList.map((g) => ({ start: g.start, duration: g.duration, motion: numberMotion(g, { schema: gfxSchema }) || undefined, ...(timed(g) ? { type: g.type, items: g.items.map((it) => ({ at: it.at })) } : {}), ...(Number.isFinite(g.pivotAt) ? { pivotAt: g.pivotAt, kind: g.kind || "versus", faceSide } : {}), ...(g.type === "message" && g.mode === "proof" ? { mode: "proof", items: g.items.map((it) => ({ at: it.at, from: it.from })), ...(g.outcome ? { outcome: { at: g.outcome.at } } : {}) } : {}), ...(Number.isFinite(g.headTop) ? { headTop: g.headTop } : {}) })),
    graphicsSchema: Math.max(gfxSchema, hasProof ? 2 : 1),
    graphicsMode: s.graphics?.mode || "overlay",
    graphicsSide: plan.framing?.side || "right",
    graphicsText: c.text,
    graphicsAccent: c.accent,
    slams: slamList.map((sl, i) => ({ t: sl.t, end: sl.end, ...(sl.popout?.src ? { popout: { i, blur: sl.popout.blur ?? 10 } } : {}) })),
    zoomStyle: s.zooms?.style || "snap",
    focusPull,
    brollCut,
    coldOpen: open ? { duration: open.duration } : null,
    lowerThird: !credentialMode && lt && lt.name ? { at: lt.at, duration: lt.duration } : null,
    ...(credentialMode ? {
      credentialLowerThird: credentialItems.map((item, i) => ({ i, at: item.at, duration: item.duration })),
      credentialMotion: { enterEase: s.brand?.motion?.enterEase || "power3.out", exitEase: s.brand?.motion?.exitEase || "power2.in" },
    } : {}),
    annotate,
    width: W,
    height: H,
    reveal,
    capCut: cap.animation === "cut",
    capDim: dimFuture,
    hookPush: s.hook?.push !== false,
    reframe: plan.reframe || [],
    fps: s.render?.fps || 30,
    base: plan.framing?.scale || 1,
    baseShift: Math.round((plan.framing?.shift || 0) * H),
    behind: behind ? { start: behind.start, duration: behind.duration } : null,
    ...(hasImpact || hasDrift ? { motion: { bumps, drift: drifts } } : {}),
    cutoutWraps: [
      ...(behind ? ["#cutout-wrap"] : []),
      ...brollList.map((b, i) => b.cutout?.src ? `#broll-cutout-wrap-${i}` : null).filter(Boolean),
      ...slamList.map((sl, i) => sl.popout?.src ? `#popout-cutout-wrap-${i}` : null).filter(Boolean),
    ],
    cutoutMedia: [
      ...(behind ? ["#cutout"] : []),
      ...brollList.map((b, i) => b.cutout?.src ? `#broll-cutout-${i}` : null).filter(Boolean),
      ...slamList.map((sl, i) => sl.popout?.src ? `#popout-cutout-${i}` : null).filter(Boolean),
    ],
  };
  if (iconList.length) runtimePlan.icons = iconList.map((icon) => ({ t: icon.t, end: icon.end }));
  if (progressList.length) runtimePlan.progress = progressList.map((g) => ({ start: g.start, duration: g.duration, hookEnd: g.hookEnd, pulses: g.pulses || [] }));
  const framing = plan.framing || { scale: 1, side: "right", face: null };
  const origin = framing.scale > 1 && framing.origin ? framing.origin : s.zooms.origin || "50% 40%";
  // Cards beside the speaker: the free third, vertically on the face.
  const fx = framing.face;
  // The box takes the empty third: from the frame edge to a fifth of a face width short of the face, never wider
  // than 30% of the frame (the podcast convention) and never under 22%.
  const room = fx ? (framing.side === "right" ? 1 - (fx.cx + fx.w / 2) : fx.cx - fx.w / 2) - 0.2 * fx.w - 0.04 : 0.3;
  const gw = Math.round(Math.max(0.22, Math.min(0.3, room)) * 100);
  const multi = !!framing.multi && fx;
  // A group: the card band sits centred above the heads (the free wall), never beside one of the people.
  const headTop = multi ? Math.min(...(framing.people || []).map((p) => p.cy - 0.75 * p.h)) : 1;
  const topOfHeads = multi ? (framing.origin ? parseFloat(framing.origin.split(" ")[1]) / 100 : 0.5) + (headTop - (parseFloat(framing.origin.split(" ")[1]) / 100 || 0.5)) * (framing.scale || 1) + (framing.shift || 0) : 1;
  const sideVars = multi
    ? `--gx: ${Math.round((100 - 36) / 2)}%; --gw: 36%; --gy: ${Math.round(Math.max(3, Math.min(8, topOfHeads * 100 - 30)))}%; --ly: 80%;`
    : fx
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
      ${fontsForSkins.css}
      html, body { margin: 0; background: #000; }
      #root { position: relative; width: 100%; height: 100%; overflow: hidden; background: #000; }
${splitBroll ? "      #footage-layout, #footage-position { position: absolute; inset: 0; will-change: transform, clip-path; }\n" : ""}      #video-wrap { position: absolute; inset: 0; transform-origin: ${origin}; will-change: transform; }
${whip ? `      #whip-wrap { position: absolute; inset: 0; filter: url(#whip-foot-filter); will-change: transform, filter; }
${brollList.map((_, i) => `      #broll-${i} { filter: url(#whip-broll-filter-${i}); will-change: transform, filter; }`).join("\n")}
` : ""}${hasImpact || hasDrift ? `      .motion-inner { position: absolute; inset: 0; transform-origin: ${origin}; will-change: transform; }\n` : ""}      #cutout-wrap { position: absolute; inset: 0; transform-origin: ${origin}; will-change: transform; pointer-events: none; }${behind?.under ? "\n      #cutout-wrap { z-index: 1; } #hook { z-index: 2; }" : ""}
      #cutout { position: absolute; inset: 0; width: 100%; height: 100%; object-fit: cover; }
      .cutout-wrap { position: absolute; inset: 0; transform-origin: ${origin}; will-change: transform; pointer-events: none; }
      .cutout-person { position: absolute; inset: 0; width: 100%; height: 100%; object-fit: cover; }
      .broll-cutout-person { filter: drop-shadow(var(--cutout-outline) 0 0 ${c.text}) drop-shadow(calc(-1 * var(--cutout-outline)) 0 0 ${c.text}) drop-shadow(0 var(--cutout-outline) 0 ${c.text}) drop-shadow(0 calc(-1 * var(--cutout-outline)) 0 ${c.text}) drop-shadow(0 ${Math.round(H * 0.009)}px ${Math.round(H * 0.014)}px ${hexA(c.stroke, 0.68)}); }
      .popout-cutout-person { opacity: 0; filter: drop-shadow(var(--cutout-outline) 0 0 ${c.text}) drop-shadow(calc(-1 * var(--cutout-outline)) 0 0 ${c.text}) drop-shadow(0 var(--cutout-outline) 0 ${c.text}) drop-shadow(0 calc(-1 * var(--cutout-outline)) 0 ${c.text}) drop-shadow(0 0 ${Math.round(H * 0.026)}px ${hexA(c.accent, 0.52)}); }
      #root { ${sideVars} }
      #footage { position: absolute; inset: 0; width: 100%; height: 100%; object-fit: cover; }
      /* Creator punch-in: the frame edges defocus for a beat while the camera moves (the centre stays sharp). */
      #defocus { position: absolute; inset: 0; opacity: 0; pointer-events: none; backdrop-filter: blur(7px); -webkit-backdrop-filter: blur(7px); -webkit-mask-image: radial-gradient(ellipse 62% 58% at 50% 45%, transparent 58%, rgba(0,0,0,0.85) 92%); mask-image: radial-gradient(ellipse 62% 58% at 50% 45%, transparent 58%, rgba(0,0,0,0.85) 92%); }
      .broll { position: absolute; inset: 0; overflow: hidden; opacity: 0; background: #000; }
      /* Finish: HyperFrames grades the still (muted editorial, vignette, film grain); the bottom keeps a scrim for the captions. */
      .broll-move { position: absolute; inset: 0; transform-origin: 50% 50%; will-change: transform; }
      .broll img, .broll video { position: absolute; inset: 0; width: 100%; height: 100%; object-fit: cover; }
      .broll-shade { position: absolute; inset: 0; background: linear-gradient(180deg, rgba(0,0,0,0) 55%, rgba(0,0,0,0.45) 100%); }${sharedBroll ? `
      .broll-window { inset: auto; box-sizing: border-box; border: ${Math.max(1, Math.round(W / 720))}px solid ${c.text}; border-radius: var(--broll-radius); background: ${c.bg || "#000"}; box-shadow: 0 ${Math.round(H * 0.012)}px ${Math.round(H * 0.03)}px rgba(0,0,0,0.34); }
      .broll-window .broll-move, .broll-window .broll-shade { border-radius: calc(var(--broll-radius) - 2px); }
      .broll-split { inset: 0 0 auto 0; height: 50%; }
      .split-divider { position: absolute; left: 0; right: 0; bottom: 0; height: ${Math.max(2, Math.round(H * 0.002))}px; background: ${c.accent}; box-shadow: 0 1px 5px rgba(0,0,0,0.36); }` : ""}
      .broll-flash { position: absolute; inset: -12%; opacity: 0; background: rgb(255,253,250); pointer-events: none; }
      #open-flash { position: absolute; inset: 0; overflow: hidden; pointer-events: none; }
      .broll-flash-core { position: absolute; inset: -18%; opacity: 0; background: radial-gradient(ellipse 68% 92% at 37% 47%, rgb(255,255,255) 0%, rgba(255,255,255,0.98) 20%, rgba(255,253,250,0.86) 45%, rgba(255,174,105,0.32) 67%, rgba(255,174,105,0) 100%); }
      .popout-bg { position: absolute; inset: 0; opacity: 0; pointer-events: none; backdrop-filter: blur(0); -webkit-backdrop-filter: blur(0); }
      #lower-third { position: absolute; left: 5%; top: 80%; display: flex; align-items: stretch; gap: ${Math.round(H * 0.012)}px; opacity: 0; pointer-events: none; }
      .lt-bar { width: ${Math.round(H * 0.008)}px; background: ${c.accent}; border-radius: ${Math.round(H * 0.004)}px; transform-origin: 50% 100%; }
      .lt-text { display: flex; flex-direction: column; justify-content: center; gap: ${Math.round(H * 0.004)}px; padding: ${Math.round(H * 0.008)}px 0; font-family: "Inter", sans-serif; color: ${c.text}; text-shadow: 0 0.06em 0.4em rgba(0,0,0,0.6); }
      .lt-name { font-size: ${Math.round(H * 0.04)}px; font-weight: 850; letter-spacing: -0.01em; line-height: 1; }
      .lt-handle { font-size: ${Math.round(H * 0.022)}px; font-weight: 600; color: ${c.accent}; letter-spacing: 0.04em; }
${credentialMode ? `${tokensCSS(s.brand)}
      .credential-lower-third { position: absolute; left: var(--lt-x); top: var(--lt-y); width: var(--lt-w); min-height: var(--lt-h); opacity: 0; overflow: hidden; pointer-events: none; }
      .credential-lower-third .lt-plate { width: 100%; min-height: var(--lt-h); display: grid; grid-template-columns: var(--space-xs) 1fr; gap: var(--space-md); box-sizing: border-box; padding: var(--space-md); overflow: hidden; color: var(--brand-ink); background: var(--brand-surface); border: calc(var(--space-xs) / 4) solid var(--brand-stroke); border-radius: var(--brand-radius-md); }
      .credential-lower-third .lt-rule { width: var(--space-xs); height: 100%; background: var(--brand-accent); border-radius: var(--brand-radius-sm); transform-origin: 50% 100%; }
      .credential-lower-third .lt-copy { min-width: 0; display: flex; flex-direction: column; justify-content: center; gap: var(--space-xs); font-family: var(--brand-body-font); font-weight: var(--brand-body-weight); line-height: var(--brand-body-line-height); }
      .credential-lower-third .lt-name-row { display: flex; align-items: center; gap: var(--space-sm); }
      .credential-lower-third .lt-name { overflow: hidden; font-family: var(--brand-display-font); font-weight: var(--brand-display-weight); font-size: var(--type-lg); line-height: var(--brand-display-line-height); letter-spacing: var(--brand-display-tracking); text-transform: var(--brand-display-case); text-overflow: ellipsis; white-space: nowrap; }
      .credential-lower-third .lt-credential { font-size: calc(var(--type-sm) + var(--space-xs) / 2); line-height: var(--brand-body-line-height); }
      .credential-lower-third .lt-organisation, .credential-lower-third .lt-source { font-size: var(--type-xs); line-height: var(--brand-body-line-height); color: var(--brand-muted); }
      .credential-lower-third .lt-source { padding-top: var(--space-xs); border-top: calc(var(--space-xs) / 4) solid var(--brand-stroke); }
      .credential-lower-third .lt-verified { flex: 0 0 var(--type-sm); width: var(--type-sm); height: var(--type-sm); color: var(--brand-accent); }
      .credential-lower-third .lt-verified svg { width: 100%; height: 100%; fill: var(--brand-surface); stroke: currentColor; stroke-width: 2; stroke-linecap: round; stroke-linejoin: round; }
` : ""}      .slam { position: absolute; inset: 0; opacity: 0; pointer-events: none; }${slamList.some((sl) => sl.popout?.src && sl.popout.placement?.fallback) ? `
      /* No spot kept the word readable behind the head (a cap or hair reaches higher than the face says): in front. */
      .slam-front { z-index: 2; }` : ""}
      .slam-stage { position: absolute; left: 5%; right: 5%; top: 4%; height: 18%; display: grid; place-items: center; }
      .slam-word { font-family: "Anton", sans-serif; font-weight: 400; line-height: 0.95; letter-spacing: 0.01em; text-transform: uppercase; color: ${c.accent}; white-space: nowrap; text-align: center; transform-origin: 50% 50%; -webkit-text-stroke: 0.016em ${c.stroke}; paint-order: stroke fill; text-shadow: 0 0.04em 0 rgba(0,0,0,0.6), 0 0.1em 0.45em rgba(0,0,0,0.6); will-change: transform, opacity; }
${iconList.length ? `      .icon-pop { position: absolute; opacity: 0; pointer-events: none; }
      .icon-disc { width: 100%; height: 100%; border-radius: 50%; display: grid; place-items: center; box-sizing: border-box; transform-origin: 50% 50%; will-change: transform, opacity; }
      .icon-disc svg { width: 55%; height: 55%; overflow: visible; }
      .icon-disc { color: ${iconSkin === "glass" ? c.accent : c.bg}; background: ${iconSkin === "glass" ? hexA(c.bg || "#0B0B0D", 0.7) : c.accent}; ${iconSkin === "glass" ? `border: 1.5px solid ${c.text};` : ""} }
` : ""}      .cap .w { position: relative; }
      .an { position: absolute; opacity: 0; overflow: visible; pointer-events: none; }
      .an path { fill: none; stroke: ${c.accent}; stroke-width: ${Math.max(3, Math.round(capFont * 0.085))}px; stroke-linecap: round; stroke-linejoin: round; vector-effect: non-scaling-stroke; }
      .an-underline { left: -3%; width: 106%; bottom: -0.2em; height: 0.24em; }
      .an-circle { left: -14%; width: 128%; top: -22%; height: 144%; }
${cardList.length ? graphicsCSS({ W, H, colors: c, mode: s.graphics?.mode || "overlay", captionTop: cap.position * H }) + skinsCSS({ H, colors: c, skins: skinsUsed }) + (hasProof ? proofMessageCSS({ H, colors: c, captionTop: cap.position * H }) : "") : ""}${progressList.length ? progressCSS({ H, colors: c }) : ""}
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
${dimFuture ? "      .cap .w { opacity: 0.38; }" : ""}` : ""}${cap.quiet ? `
      .cap-line { font-family: "Inter", sans-serif; font-weight: 600; line-height: 1.2; letter-spacing: 0; -webkit-text-stroke: 0; text-shadow: 0 0.03em 0.08em rgba(0,0,0,0.45), 0 0.04em 0.24em rgba(0,0,0,0.4); gap: 0.06em 0.26em; }
      .cap .w.k { color: #111111; background: ${c.accent}; padding: 0 0.16em; border-radius: 0.14em; text-shadow: none; }` : ""}
      #hook {
        position: absolute; inset: 0; display: flex; align-items: flex-start; justify-content: center;
        padding: ${Math.max(0, Math.round(hk.position * H - hookFont * 1.2))}px 7% 0; box-sizing: border-box;
        font-family: "Anton", sans-serif; font-weight: 400; font-size: ${hookFont}px; line-height: 1.05; letter-spacing: 0.01em;
        text-transform: ${hk.uppercase === false ? "none" : "uppercase"}; color: ${hookColor}; text-align: center;
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
      .hook-cursor { display: inline-block; width: 0.5em; height: 0.9em; margin-left: 0.14em; vertical-align: -0.1em; background: ${c.accent}; }${themeCSS({ H, colors: c, theme })}${brandQuiet ? brandQuietCSS({ H, colors: c }) : ""}
    </style>
  </head>
  <body>
    <div id="root" data-composition-id="reel" data-start="0" data-width="${W}" data-height="${H}" data-duration="${D}" data-fps="${s.render?.fps || 30}"${plan.video.hasAudio || tracks.length ? ` data-fx-chain="${esc(JSON.stringify({ version: 1, nodes: [{ type: "truepeak", id: "ceiling", label: "Delivery ceiling", params: { ceiling: -1.5, lookahead: 3, release: 80 } }] }))}"` : ""}>
${whipFiltersHTML}${videoLayerHTML}
${runtimePlan.zoomStyle === "camera" && runtimePlan.zooms.length ? `      <div id="defocus"></div>` : ""}
${openHTML}
${brollHTML}
${popoutBgHTML}
${lowerHTML}
${gfxHTML}${progressRailHTML ? `\n${progressRailHTML}` : ""}
${slamHTML}${iconHTML ? `\n${iconHTML}` : ""}
${hookHTML}
${cutoutHTML}
${brollCutoutHTML}
${popoutCutoutHTML}
      <div id="captions" data-layout-allow-caption-zone data-layout-allow-overflow>
${capsHTML}
      </div>
${ctaHTML}
${audioHTML}
    </div>
    <script>
      const PLAN = ${JSON.stringify(runtimePlan)};
      (function () {
        const tl = gsap.timeline({ paused: true });
        // Every footage move is mirrored on every person cutout, so hook, slam and b-roll mattes stay registered.
        const WRAP = PLAN.cutoutWraps.length ? ["#video-wrap", ...PLAN.cutoutWraps] : "#video-wrap";
        const FOOT = PLAN.cutoutMedia.length ? ["#footage", ...PLAN.cutoutMedia] : "#footage";
        // The hook never covers the head: with hook.headTop (the head top at the opening push-in) the real hook text is
        // measured and the whole hook moves up until it ends 1.5% of the frame above the head, never above the 7% top
        // bar; only if it still does not fit does it shrink toward its top (to 60% at most). Without a measurement the
        // hook is left as placed.
        if (PLAN.hook && Number.isFinite(PLAN.hook.headTop)) {
          const hookEl = document.getElementById("hook");
          const root = document.getElementById("root").getBoundingClientRect();
          const k = root.height ? root.height / PLAN.height : 1;
          let top = Infinity, bottom = -Infinity;
          hookEl.querySelectorAll("*").forEach((n) => {
            if (n.id === "hook-scrim" || n.closest("#hook-scrim")) return;
            const r = n.getBoundingClientRect();
            if (r.width && r.height) { top = Math.min(top, (r.top - root.top) / k); bottom = Math.max(bottom, (r.bottom - root.top) / k); }
          });
          const limit = PLAN.hook.headTop * PLAN.height - PLAN.height * 0.015;
          // A hook placed under the chin (wide shots) is already clear of the head; only an overlap moves it.
          const overlaps = top < (PLAN.hook.headBottom ?? 1) * PLAN.height;
          if (Number.isFinite(bottom) && overlaps && bottom > limit && bottom > top) {
            const bar = PLAN.height * 0.07, height = bottom - top;
            const y = Math.max(bar - top, limit - bottom);
            const scale = top + y + height > limit ? Math.max(0.6, (limit - top - y) / height) : 1;
            gsap.set(hookEl, { scale, y, transformOrigin: "50% " + Math.round(top) + "px" });
          }
        }
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
          // The look's treatment: never hides a word on frame 0 (it is the cover).
          if (h.treat === "stamp") tl.fromTo("#hook-lines", { scale: 1.06 }, { scale: 1, duration: 0.26, ease: "back.out(1.6)" }, t0);
          const cursor = document.querySelector(".hook-cursor");
          if (cursor) for (let k = 0; k * 0.5 < h.duration; k++) tl.set(cursor, { opacity: k % 2 ? 0 : 1 }, t0 + k * 0.5);
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
            if (!PLAN.capCut) tl.fromTo(line, { y: 14, opacity: 0 }, { y: 0, opacity: 1, duration: 0.12, ease: "power2.out" }, g.start);
            if (PLAN.capDim) g.words.forEach((w, j) => tl.fromTo("#cap-" + i + "-w" + j, { opacity: 0.38 }, { opacity: 1, duration: 0.07, ease: "none", immediateRender: false }, Math.max(g.start, w[0])));
          } else if (!PLAN.capCut) {
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
          tl.set(FOOT, { objectPosition: first.x + "% 50%" }, 0);
          for (let i = 1; i < PLAN.reframe.length; i++) {
            const p = PLAN.reframe[i], q = PLAN.reframe[i - 1];
            if (p.cut) tl.set(FOOT, { objectPosition: p.x + "% 50%" }, p.t);
            else tl.to(FOOT, { objectPosition: p.x + "% 50%", duration: Math.max(0.2, p.t - q.t), ease: "power1.inOut" }, q.t);
          }
        }
        // Base framing (long form): a tighter default frame on a wide shot; every punch-in is relative to it.
        const BASE = PLAN.base || 1;
        if (BASE !== 1 || PLAN.baseShift) tl.set(WRAP, { scale: BASE, y: PLAN.baseShift || 0 }, 0);
        // Motion from the first frame: a slow push-in under the hook (a static face in frame 1 reads as a still).
        if (PLAN.hook && PLAN.hookPush) tl.fromTo(WRAP, { scale: BASE }, { scale: BASE * 1.06, duration: Math.max(1, PLAN.hook.duration), ease: "power1.out" }, 0);
        // Punch-ins. "camera": the creator move (push with a slight tilt and lift, the edges defocus for a beat, a slow
        // return); "snap": the hard cut-in zoom.
        // Cut cadence: an instant change of framing (a jump cut) between the punch-ins.
        const jump = (z) => tl.set(WRAP, { scale: z.scale * BASE, xPercent: z.xPercent || 0, yPercent: z.scale > 1 ? -0.6 : 0, rotationX: 0, rotationY: 0 }, z.t);
        if (PLAN.zoomStyle === "camera") {
          gsap.set(WRAP, { transformPerspective: 1200 });
          let n = 0;
          PLAN.zooms.forEach((z) => {
            if (z.cut) jump(z);
            else if (z.scale > 1) {
              const dir = n++ % 2 ? 1 : -1;
              tl.to(WRAP, { scale: z.scale * BASE, xPercent: z.xPercent || 0, yPercent: -1.2, rotationX: 1.8, rotationY: 1.2 * dir, duration: 0.55, ease: "power3.out" }, z.t);
              tl.to("#defocus", { opacity: 1, duration: 0.3, ease: "power2.out" }, z.t);
              tl.to("#defocus", { opacity: 0, duration: 0.45, ease: "power2.in" }, z.t + 0.3);
            } else {
              tl.to(WRAP, { scale: BASE, xPercent: 0, yPercent: 0, rotationX: 0, rotationY: 0, duration: 0.9, ease: "power2.inOut" }, z.t);
            }
          });
        } else PLAN.zooms.forEach((z) => (z.cut ? jump(z) : tl.to(WRAP, { scale: z.scale * BASE, xPercent: z.xPercent || 0, duration: z.snap, ease: "power3.out" }, z.t)));
${hasImpact || hasDrift ? `        // Drift and impact are isolated from WRAP, so their scales multiply the active punch-in instead of replacing it.
        const MOTION_FRAME = 1 / (PLAN.fps || 30);
${hasDrift ? `        const DRIFT = ".drift-inner";
        PLAN.motion.drift.forEach((d) => {
          tl.fromTo(DRIFT, { scale: 1 }, { scale: d.scale, duration: d.end - d.start, ease: "sine.inOut", immediateRender: false }, d.start);
          if (d.reset === "cut") tl.set(DRIFT, { scale: 1 }, d.end);
          else tl.to(DRIFT, { scale: 1, duration: d.out || 5 * MOTION_FRAME, ease: d.reset === "move" ? "power3.out" : "power2.in" }, d.end);
        });
` : ""}${hasImpact ? `        const IMPACT = ".impact-inner";
        PLAN.motion.bumps.forEach((b) => {
          tl.fromTo(IMPACT, { scale: 1 }, { scale: b.scale, duration: 2 * MOTION_FRAME, ease: "expo.out", immediateRender: false }, b.t);
          tl.to(IMPACT, { scale: 1, duration: 4 * MOTION_FRAME, ease: "power2.out" }, b.t + 2 * MOTION_FRAME);
        });
` : ""}` : ""}        // Cold open: the still holds under the hook with a slow push, the flash hits on the cut to the speaker.
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
${cardList.length ? GRAPHICS_JS : ""}${progressList.length ? PROGRESS_JS : ""}
        // B-roll: hard cut in and out. The push (6%, ease-out, settles before the end) and the Ken Burns pans (a
        // steady drift with a little scale, no ease) run on the wrapper; the cut lands with a short focus pull.
        // A generated clip already moves, so it gets no push: "none" holds the frame.
        const MOVES = { none: [{ scale: 1.0 }, { scale: 1.0, ease: "none" }], in: [{ scale: 1.0 }, { scale: 1.06, ease: "power2.out" }], out: [{ scale: 1.06 }, { scale: 1.0, ease: "power2.out" }], left: [{ scale: 1.04, xPercent: 1.6 }, { scale: 1.07, xPercent: -1.6, ease: "none" }], right: [{ scale: 1.04, xPercent: -1.6 }, { scale: 1.07, xPercent: 1.6, ease: "none" }] };
        PLAN.broll.forEach((b, i) => {
          const el = document.getElementById("broll-" + i);
          const m = MOVES[b.motion] || MOVES.in;
          const img = el.querySelector(".broll-media");
          const bEnd = b.start + b.duration;
${sharedBroll ? `          if (b.layout === "window") {
            tl.fromTo(el, { opacity: 0, scale: 0.94, y: PLAN.height * 0.0125 }, { opacity: 1, scale: 1, y: 0, duration: 8 / 30, ease: "power3.out", immediateRender: false }, b.start);
            if (PLAN.focusPull) tl.fromTo(img, { "--hf-color-grading-blur": PLAN.focusPull }, { "--hf-color-grading-blur": 0, duration: 0.32, ease: "power3.out", immediateRender: false }, b.start);
            tl.fromTo(el.querySelector(".broll-move"), m[0], { ...m[1], duration: b.duration * 0.92 }, b.start);
            tl.to(el, { opacity: 0, scale: 0.98, y: -PLAN.height * 0.006, duration: 5 / 30, ease: "power2.in" }, bEnd - 5 / 30);
            return;
          }
          if (b.layout === "split") {
            // The seam sits where the planner left room for the head above the captions (36-50% down).
            const seam = b.seamY || PLAN.height / 2;
            tl.fromTo(el, { opacity: 1, y: -seam }, { opacity: 1, y: 0, duration: 8 / 30, ease: "power3.out", immediateRender: false }, b.start);
            tl.fromTo("#footage-layout", { clipPath: "inset(0% 0 0 0)" }, { clipPath: "inset(" + (seam / PLAN.height) * 100 + "% 0 0 0)", duration: 8 / 30, ease: "power3.out", immediateRender: false }, b.start);
            tl.fromTo("#footage-position", { y: 0 }, { y: b.footageY, duration: 8 / 30, ease: "power3.out", immediateRender: false }, b.start);
            if (PLAN.focusPull) tl.fromTo(img, { "--hf-color-grading-blur": PLAN.focusPull }, { "--hf-color-grading-blur": 0, duration: 0.32, ease: "power3.out", immediateRender: false }, b.start);
            tl.fromTo(el.querySelector(".broll-move"), m[0], { ...m[1], duration: b.duration * 0.92 }, b.start);
            tl.to(el, { y: -seam, duration: 6 / 30, ease: "power2.in" }, bEnd - 6 / 30);
            tl.to("#footage-layout", { clipPath: "inset(0% 0 0 0)", duration: 6 / 30, ease: "power2.in" }, bEnd - 6 / 30);
            tl.to("#footage-position", { y: 0, duration: 6 / 30, ease: "power2.in" }, bEnd - 6 / 30);
            tl.set(el, { opacity: 0 }, bEnd);
            return;
          }
` : ""}          ${whip ? `if (PLAN.brollCut === "whip") {
            const frames = 7 / (PLAN.fps || 30), peak = 3 / (PLAN.fps || 30), outAt = bEnd - frames;
            const footBlur = document.getElementById("whip-foot-blur"), brollBlur = document.getElementById("whip-broll-blur-" + i);
            const blur = (node, at) => {
              tl.fromTo(node, { attr: { stdDeviation: "0 0" } }, { attr: { stdDeviation: "42 0" }, duration: peak, ease: "power2.in", immediateRender: false }, at);
              tl.to(node, { attr: { stdDeviation: "0 0" }, duration: frames - peak, ease: "power2.out" }, at + peak);
            };
            tl.set(el, { opacity: 1 }, b.start);
            tl.fromTo("#whip-wrap", { xPercent: 0 }, { xPercent: -14, duration: frames, ease: "power2.inOut", immediateRender: false }, b.start);
            tl.fromTo(el, { xPercent: 14 }, { xPercent: 0, duration: frames, ease: "power2.inOut", immediateRender: false }, b.start);
            blur(footBlur, b.start); blur(brollBlur, b.start);
            tl.set("#whip-wrap", { xPercent: -14 }, outAt);
            tl.to("#whip-wrap", { xPercent: 0, duration: frames, ease: "power2.inOut" }, outAt);
            tl.to(el, { xPercent: 14, duration: frames, ease: "power2.inOut" }, outAt);
            blur(footBlur, outAt); blur(brollBlur, outAt);
            tl.set(el, { opacity: 0 }, bEnd);
          } else ` : ""}if (PLAN.brollCut === "blur") {
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
        if (PLAN.credentialLowerThird) {
          const frame = 1 / (PLAN.fps || 30);
          PLAN.credentialLowerThird.forEach((item) => {
            const root = "#credential-lower-third-" + item.i;
            const plate = root + " .lt-plate";
            const enter = 8 * frame, exit = 5 * frame;
            const out = item.at + item.duration - exit;
            tl.set(root, { opacity: 1 }, item.at);
            tl.fromTo(plate, { clipPath: "inset(0 100% 0 0)" }, { clipPath: "inset(0 0% 0 0)", duration: enter, ease: PLAN.credentialMotion.enterEase, immediateRender: false }, item.at);
            tl.fromTo(root + " .lt-rule", { scaleY: 0 }, { scaleY: 1, duration: enter, ease: PLAN.credentialMotion.enterEase, immediateRender: false }, item.at);
            tl.to(plate, { clipPath: "inset(0 100% 0 0)", duration: exit, ease: PLAN.credentialMotion.exitEase }, out);
            tl.to(root + " .lt-rule", { scaleY: 0, duration: exit, ease: PLAN.credentialMotion.exitEase }, out);
            tl.set(root, { opacity: 0 }, item.at + item.duration);
          });
        }
${iconList.length ? `        // Spoken icons: a seven-frame sticker landing, a small float, then a five-frame exit.
        const iconFrame = 1 / (PLAN.fps || 30);
        PLAN.icons.forEach((icon, i) => {
          const el = document.getElementById("icon-" + i);
          const disc = el.querySelector(".icon-disc");
          const turn = i % 2 ? 8 : -8;
          const settled = icon.t + 7 * iconFrame;
          const outAt = Math.max(settled, icon.end - 5 * iconFrame);
          tl.set(el, { opacity: 1 }, icon.t);
          tl.fromTo(disc, { scale: 0, rotation: turn, opacity: 0 }, { scale: 1.12, rotation: -turn * 0.18, opacity: 1, duration: 4 * iconFrame, ease: "back.out(1.8)" }, icon.t);
          tl.to(disc, { scale: 1, rotation: 0, duration: 3 * iconFrame, ease: "power2.out" }, icon.t + 4 * iconFrame);
          const floatFor = outAt - settled;
          if (floatFor > 2 * iconFrame) tl.to(disc, { y: i % 2 ? 3 : -3, duration: floatFor / 2, ease: "sine.inOut", yoyo: true, repeat: 1 }, settled);
          tl.to(disc, { scale: 0.8, opacity: 0, duration: 5 * iconFrame, ease: "power2.in" }, outAt);
          tl.set(el, { opacity: 0 }, icon.end);
        });
` : ""}        // Climax words: slam down from 1.6x with expo weight, a three-frame impact shake, a quiet drift, a whip up and out.
        const frame = 1 / (PLAN.fps || 30);
        PLAN.slams.forEach((sl, i) => {
          const el = document.getElementById("slam-" + i);
          const stage = el.querySelector(".slam-stage");
          const word = el.querySelector(".slam-word");
          const land = 0.42;
          const outAt = Math.max(sl.t + land + 3 * frame, sl.end - 0.28);
          if (sl.popout) {
            const bg = document.getElementById("popout-bg-" + i);
            const person = document.getElementById("popout-cutout-" + i);
            const release = Math.max(sl.t + 6 * frame, sl.end - 8 * frame);
            tl.fromTo(bg, { opacity: 0, backdropFilter: "blur(0px)", webkitBackdropFilter: "blur(0px)" }, { opacity: 1, backdropFilter: "blur(" + sl.popout.blur + "px)", webkitBackdropFilter: "blur(" + sl.popout.blur + "px)", duration: 6 * frame, ease: "power2.out", immediateRender: false }, sl.t);
            tl.fromTo(person, { opacity: 0 }, { opacity: 1, duration: 3 * frame, ease: "expo.out", immediateRender: false }, sl.t);
            tl.to(bg, { opacity: 0, backdropFilter: "blur(0px)", webkitBackdropFilter: "blur(0px)", duration: 8 * frame, ease: "power2.in" }, release);
            tl.to(person, { opacity: 0, duration: 8 * frame, ease: "power2.in" }, release);
          }
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
