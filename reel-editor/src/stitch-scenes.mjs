import fs from "node:fs";
import { planCuts } from "./cuts.mjs";
import { faceBox, baseFraming, headExtent, placeCaptions } from "./placement.mjs";
import { eventClock } from "./event-clock.mjs";

const frame = (t) => Math.round(t * 30);
export function validateStitchScenes(scenes, duration) {
  if (!Array.isArray(scenes) || !scenes.length) throw new Error("The scenes file must contain an ordered array.");
  let end = 0;
  for (const [i, s] of scenes.entries()) {
    if (![s.start, s.end].every(Number.isFinite) || s.end <= s.start || Math.abs(s.start - end) > 1e-6 || [s.start, s.end].some((t) => Math.abs(t * 30 - frame(t)) > 1e-5) || ![i ? "take" : "start", ...(i ? ["place"] : [])].includes(s.join)) throw new Error("The scenes file must use contiguous whole frames at 30 fps.");
    end = s.end;
  }
  if (Math.abs(end - duration) > 1 / 30 + 1e-6) throw new Error("The scenes file does not match this master.");
  return scenes;
}

export function loadStitchScenes(file, duration) {
  return validateStitchScenes(JSON.parse(fs.readFileSync(file, "utf8")), duration);
}

export function sceneAt(scenes, t) {
  return scenes?.find((s) => t >= s.start - 1e-7 && t < s.end - 1e-7) || scenes?.at(-1) || null;
}

/** Shared by cards, cutaways, glow picks and bold overlays. A crossing visual is simply left out. */
export function fitSceneWindow(item, scenes, { start = item.start ?? item.t ?? item.at, end = item.end ?? start + item.duration } = {}) {
  if (!scenes?.length) return item;
  if (!Number.isFinite(start) || !Number.isFinite(end)) return null;
  return scenes.some((s) => s.start > start + 1e-7 && s.start < end - 1e-7) ? null : item;
}

/** Cuts are planned independently inside each scene. Its opening word and picture boundary always survive. */
export function planSceneCuts(words, duration, scenes, settings = {}) {
  const segments = [], keptWords = [], removed = [];
  for (const [i, scene] of scenes.entries()) {
    const local = words.filter((w) => w.start >= scene.start && w.start < scene.end).map((w) => ({ ...w, start: w.start - scene.start, end: Math.min(w.end, scene.end) - scene.start }));
    const d = scene.end - scene.start;
    const cuts = local.length ? planCuts(local, d, { ...settings, endAt: null, signOff: i === scenes.length - 1 && settings.signOff }) : { segments: [{ start: 0, end: d }], words: [], removed: [] };
    const ranges = [...cuts.segments];
    if (local.length) {
      ranges.push({ start: 0, end: Math.min(d, Math.ceil((local[0].end + 0.12) * 30) / 30) });
      const opening = cuts.words.find((w) => w.start === local[0].start);
      if (opening) delete opening.drop;
    }
    ranges.sort((a, b) => a.start - b.start);
    const merged = [];
    for (const r of ranges) {
      const a = Math.max(0, Math.floor(r.start * 30) / 30), b = Math.min(d, Math.ceil(r.end * 30) / 30);
      const prior = merged.at(-1);
      if (prior && a <= prior.end + 1e-7) prior.end = Math.max(prior.end, b);
      else merged.push({ start: a, end: b });
    }
    // Retain the last frame too, so a cut never migrates onto the preceding scene's word.
    if (merged.length) merged.at(-1).end = d;
    segments.push(...merged.map((s) => ({ start: (frame(scene.start) + frame(s.start)) / 30, end: (frame(scene.start) + frame(s.end)) / 30 })));
    keptWords.push(...cuts.words.map((w) => ({ ...w, start: w.start + scene.start, end: w.end + scene.start })));
    removed.push(...cuts.removed.map((r) => ({ ...r, start: r.start + scene.start, end: r.end + scene.start })));
  }
  return { segments, words: keptWords, removed, originalDuration: duration, keptDuration: segments.reduce((n, s) => n + s.end - s.start, 0) };
}

export function remapStitchScenes(scenes, segments) {
  let cursor = 0;
  const mapped = [];
  for (const scene of scenes) {
    const frames = segments.reduce((n, s) => n + Math.max(0, frame(Math.min(s.end, scene.end)) - frame(Math.max(s.start, scene.start))), 0);
    if (!frames) throw new Error("An edit removed a whole stitch scene.");
    mapped.push({ ...scene, start: cursor / 30, end: (cursor + frames) / 30 }); cursor += frames;
  }
  return mapped;
}

export async function measureSceneFaces(video, scenes, detect, preset) {
  const results = [];
  for (const scene of scenes) {
    const times = [0.1, 0.3, 0.5, 0.7, 0.9].map((f) => Math.min(scene.end - 1 / 30, scene.start + f * (scene.end - scene.start)));
    const detection = await detect(video, times), face = faceBox(detection);
    const framing = preset.framing?.enabled ? baseFraming(face, { target: preset.framing.faceHeight ?? 0.27, max: preset.framing.max ?? 1.3, eyeLine: preset.framing.eyeLine ?? 0.42 }) : { scale: 1, origin: preset.zooms?.origin || "50% 40%", shift: 0 };
    const head = headExtent(detection, { zoom: framing.scale * 1.08, originY: parseFloat(framing.origin.split(" ")[1]) / 100 });
    const captions = placeCaptions(head, { fontSizeFrac: preset.captions.fontSizeFrac, defaultPosition: preset.captions.position, min: preset.captions.placeMin ?? 0.56, max: preset.captions.placeMax ?? 0.76 });
    results.push({ ...scene, detection, face, framing, captionPosition: preset.captions.autoPlace ? captions.position : preset.captions.position });
  }
  return results;
}

export function sceneZooms(keys, scenes, words = []) {
  const moves = [], reserved = [];
  for (const scene of scenes.slice(1)) {
    const sentence = words.find((w) => w.start >= scene.start && w.end <= scene.end && /[.!?]["'”’)]*$/.test(w.text));
    const end = scene.join === "place" ? Math.min(scene.end, scene.start + 12 / 30) : sentence ? Math.ceil(sentence.end * 30) / 30 : scene.end;
    reserved.push({ start: scene.start, end });
    moves.push({ t: scene.start, scale: scene.join === "place" ? 1.06 : 1.08, snap: 0, cut: true, stitch: true });
    if (end < scene.end || scene.join === "place") moves.push({ t: end, scale: 1, snap: 0, cut: true, stitch: true, ...(scene.join === "place" ? { settleFrom: scene.start } : {}) });
  }
  const normal = keys.filter((k) => !k.stitch && !reserved.some((r) => k.t >= r.start - 0.5 && k.t <= r.end) && !scenes.slice(1).some((s) => k.t < s.start && k.t + Math.max(k.snap || 0, 0.9) > s.start));
  return [...normal, ...moves].sort((a, b) => a.t - b.t);
}

export function sceneSoundTracks(scenes) {
  // move.wav is the existing quiet whoosh. Its measured peak lands on the cut frame.
  return scenes.filter((s) => s.join === "place").map((s, i) => ({ id: `stitch-place-${i + 1}`, src: "assets/sfx/move.wav", start: eventClock({ landAt: s.start, sfx: "move.wav", fps: 30 }).start, duration: 0.16, volume: 0.1, track: 11 }));
}

/** The final admission gate also covers cached and restyled plans. It is a no-op without a scenes file. */
export function applyScenePlan(plan) {
  const scenes = plan.stitchScenes;
  if (!scenes?.length) return plan;
  const keep = (list) => (list || []).filter((x) => fitSceneWindow(x, scenes));
  const previousIcons = plan.icons || [];
  for (const key of ["graphics", "broll", "evidence", "glowScenes", "glowOverlays", "slams", "icons", "timeLabels"]) if (plan[key]) plan[key] = keep(plan[key]);
  for (const scene of plan.glowScenes || []) if (Number.isInteger(scene.bridge)) {
    const bridge = (plan.icons || []).indexOf(previousIcons[scene.bridge]);
    if (bridge < 0) delete scene.bridge; else scene.bridge = bridge;
  }
  for (const key of ["hook", "cta", "premise", "coldOpen", "behind"]) if (plan[key]) {
    const x = plan[key], start = x.start ?? 0, end = x.end ?? start + x.duration;
    if (!fitSceneWindow(x, scenes, { start, end })) {
      if (["hook", "behind"].includes(key)) plan[key] = { ...x, duration: scenes[0].end - start };
      else plan[key] = null;
    }
  }
  if (plan.lowerThird) {
    if (plan.lowerThird.items) plan.lowerThird.items = keep(plan.lowerThird.items);
    else if (!fitSceneWindow(plan.lowerThird, scenes)) plan.lowerThird = null;
  }
  if (plan.bold) {
    plan.bold.overlays = keep(plan.bold.overlays);
    if (plan.bold.headline && !fitSceneWindow(plan.bold.headline, scenes)) {
      plan.bold.headline.end = scenes[0].end; plan.bold.headline.endFrame = frame(scenes[0].end);
    }
  }
  // Normal captions retain all spoken words and split at the join. Display text follows those same words.
  plan.captions = (plan.captions || []).flatMap((g) => {
    if (fitSceneWindow(g, scenes)) return [g];
    if (g.kind === "feat" && !g.run) return [];
    return scenes.map((s) => {
      const words = (g.words || []).filter((w) => w.start >= s.start && w.start < s.end);
      return words.length ? { ...g, ...(g.place && g.run ? { place: { ...g.place, y: Math.round(Math.min(0.715, sceneAt(plan.stitchFaces, s.start)?.captionPosition || 0.65) * plan.canvas.height) } } : {}), words, text: words.map((w) => w.text).join(" "), start: Math.max(g.start, s.start), end: Math.min(g.end, s.end) } : null;
    }).filter(Boolean);
  });
  plan.zooms = sceneZooms(plan.zooms || [], scenes, plan.words);
  if (plan.motion) { plan.motion.drift = keep(plan.motion.drift); plan.motion.bumps = keep((plan.motion.bumps || []).map((b) => ({ ...b, end: b.t + 6 / 30 }))); }
  plan.audio ||= { tracks: [] };
  plan.audio.tracks = [...(plan.audio.tracks || []).filter((t) => !t.id?.startsWith("stitch-place-")), ...sceneSoundTracks(scenes)];
  return plan;
}

/** Gated composer additions keep every legacy HTML byte intact. Scene keys share the normal zoom wrapper. */
export function stitchTimeline(plan) {
  if (!plan.stitchScenes?.length) return "";
  const facts = plan.stitchFaces || plan.stitchScenes.map((s) => ({ ...s, framing: { scale: 1, origin: "50% 40%", shift: 0 } }));
  const firstBase = plan.framing?.scale || 1;
  let js = "";
  for (const scene of facts) {
    const base = scene.framing?.scale || 1, origin = scene.framing?.origin || "50% 40%";
    js += `        tl.set(WRAP, { scale: ${base}, transformOrigin: ${JSON.stringify(origin)}, y: ${Math.round((scene.framing?.shift || 0) * plan.canvas.height)}, xPercent: 0, yPercent: 0, rotationX: 0, rotationY: 0 }, ${scene.start});\n`;
  }
  for (const key of (plan.zooms || []).filter((k) => k.stitch)) {
    const base = sceneAt(facts, key.settleFrom ?? key.t)?.framing?.scale || firstBase;
    if (key.settleFrom != null) js += `        tl.to(WRAP, { scale: ${base}, duration: ${key.t - key.settleFrom}, ease: "power2.out" }, ${key.settleFrom});\n`;
    else js += `        tl.set(WRAP, { scale: ${key.scale * base} }, ${key.t});\n`;
  }
  let n = 0;
  for (const key of (plan.zooms || []).filter((k) => !k.stitch)) {
    const base = sceneAt(facts, key.t)?.framing?.scale || firstBase;
    const camera = plan.style?.zooms?.style === "camera", scale = base * key.scale;
    if (key.cut) js += `        tl.set(WRAP, { scale: ${scale}, xPercent: ${key.xPercent || 0}, yPercent: ${key.scale > 1 ? -0.6 : 0}, rotationX: 0, rotationY: 0 }, ${key.t});\n`;
    else if (camera && key.scale > 1) {
      const dir = n++ % 2 ? 1 : -1;
      js += `        tl.to(WRAP, { scale: ${scale}, xPercent: ${key.xPercent || 0}, yPercent: -1.2, rotationX: 1.8, rotationY: ${1.2 * dir}, duration: ${key.onKey ? key.snap : 0.55}, ease: "power3.out" }, ${key.t});\n`;
      js += `        tl.to("#defocus", { opacity: 1, duration: 0.3, ease: "power2.out" }, ${key.t});\n        tl.to("#defocus", { opacity: 0, duration: 0.45, ease: "power2.in" }, ${key.t + 0.3});\n`;
    } else js += `        tl.to(WRAP, { scale: ${scale}, xPercent: ${key.xPercent || 0}, yPercent: 0, rotationX: 0, rotationY: 0, duration: ${camera ? 0.9 : key.snap || 0}, ease: "power3.out" }, ${key.t});\n`;
  }
  for (const [i, group] of (plan.captions || []).entries()) {
    const scene = sceneAt(facts, group.start);
    if (scene?.captionPosition && !group.place) js += `        tl.set("#cap-${i}", { top: "${scene.captionPosition * 100}%" }, 0);\n`;
  }
  return js;
}

export function detectionInScene(detection, scenes, t) {
  const scene = sceneAt(scenes, t);
  return detection && scene ? { ...detection, frames: (detection.frames || []).filter((f) => f.t >= scene.start && f.t < scene.end) } : detection;
}

/** Bold keeps source word indexes, while each scene gets its own measured caption rectangle. */
export function layoutSceneBold(plan, picks, detection, options, layout, fit, clean) {
  const layouts = plan.stitchScenes.map((scene) => {
    const measured = layout(plan, picks, detectionInScene(detection, plan.stitchScenes, scene.start), options);
    const groups = measured.groups.flatMap((g) => {
      const indexes = plan.words.map((w, i) => ({ ...w, index: i })).slice(g.from, g.to + 1).filter((w) => w.start >= scene.start && w.start < scene.end);
      if (!indexes.length) return [];
      const from = indexes[0].index, to = indexes.at(-1).index, start = Math.max(g.start, scene.start), end = Math.min(g.end, scene.end);
      const text = indexes.map((w) => clean(w.text));
      return [{ ...g, from, to, start, end, startFrame: frame(start), endFrame: frame(end), text: text.join(" "), place: { ...g.place, ...fit(text, { size: g.place.size, width: g.place.w, maxHeight: Math.max(1, g.place.h), lineHeight: options.settings[g.mode].lineHeight }) } }];
    });
    return { scene, measured, groups };
  });
  return { ...layouts[0].measured, groups: layouts.flatMap((l) => l.groups), sceneZones: layouts.map(({ scene, measured }) => ({ ...scene, zones: measured.zones })) };
}

/** Ending overrides keep a crossing word whole and never borrow the opening of the next scene. */
export function endSceneCuts(cuts, scenes, endAt, duration, pad = 0.12) {
  const words = cuts.words, kept = words.filter((w) => w.start < endAt && !w.drop);
  if (!kept.length) throw new Error("The ending falls before the first kept word.");
  const last = Math.max(...kept.map((w) => w.end));
  const next = words.find((w) => w.start >= endAt)?.start ?? duration;
  const scene = sceneAt(scenes, Math.max(0, endAt - 1e-7));
  const stop = Math.min(scene.end, Math.ceil(Math.min(next, last + pad) * 30) / 30);
  const segments = cuts.segments.filter((s) => s.start < stop).map((s) => ({ start: s.start, end: Math.min(s.end, stop) }));
  return { ...cuts, segments, words: words.map((w) => w.start >= endAt ? { ...w, drop: "ending" } : w), removed: [...cuts.removed, { start: stop, end: duration, reason: "ending" }], keptDuration: segments.reduce((n, s) => n + s.end - s.start, 0) };
}
