import { r3 } from "./util.mjs";

/** Greg wants graphics-rich reels: short clean holds, a quick settle after scenes, up to three band starts per 3 s. */
export const CLEAN_SHARE = 0.1, SCENE_SETTLE = 0.6, BAND_MAX = 3;
// Scenes cover about a third of the reel; the hard cap leaves room so a scene every 4 to 7 s is not cut for being a
// few hundredths of a second over a third (the 11-09 fathom re-pick lost a whole 3.7 s scene that way).
export const SCENE_SHARE = 0.4;
// The prompt asks for clean holds of about 10 to 15% of the reel; more than this is a sparse reel.
const CLEAN_MAX = 0.15;

/** Display windows, including entrances and holds, shared by pacing and layout. */
export function glowWindow(kind, pick, words, duration, hookEnd = 3) {
  const first = words[pick.from ?? pick.word], last = words[pick.to ?? pick.word];
  let start, end;
  if (kind === "scenes") {
    // A thread opens early for its first typing dots; every scene holds 0.9 s after its last timed piece (an item,
    // the branch, the right side, the end of the last bubble) and at least 1.8 s in all.
    const base = r3(first.start - 0.05);
    const at = (x) => (x && Number.isInteger(x.word) ? words[x.word].start : 0);
    const lastAt = Math.max(0, ...(pick.items || []).map(at), at(pick.branch), at(pick.left), at(pick.right), ...(pick.bubbles || []).map((b) => words[b.to]?.end || 0));
    start = base - (pick.type === "thread" ? 0.4 : 0.1);
    end = Math.max(last.end + 0.5, base + 1.8, lastAt + 0.9);
  } else if (kind === "icons") {
    start = first.start - 0.08; end = last.end + 1;
  } else if (kind === "features") {
    start = first.start - 0.05; end = last.end + 0.35;
  } else {
    start = first.start - (pick.type === "stamp" ? 0.03 : 0.1);
    end = last.end + (pick.type === "stamp" ? 0.7 : 0.6);
  }
  return { start: r3(Math.max(hookEnd, start)), end: r3(Math.min(duration - (kind === "icons" ? 0.2 : 0.05), end)) };
}

/** The library icon a scene opens with (a band icon of the same name can fly into its place), or null. */
export function sceneFirstIcon(scene) {
  if (scene.type === "list") return scene.items?.[0]?.icon || null;
  if (scene.type === "versus") return scene.left?.icon || null;
  if (scene.type === "people") return "person";
  if (["icons", "number"].includes(scene.type || "icons")) return scene.icon || scene.icons?.[0] || null;
  return null;
}

/** Trim checked picks without inventing beats. A sparse plan may exceed the clean-hold target (CLEAN_MAX). */
export function pacingReport(picks, words, duration, { hookEnd = 3 } = {}) {
  const D = Number.isFinite(duration) ? Math.max(0, duration) : Math.max(hookEnd, ...words.map((w) => w.end)) + 0.5;
  const priority = { scenes: 3, features: 2, overlays: 1, icons: 0 };
  const entries = Object.keys(priority).flatMap((kind) => (picks[kind] || []).map((pick, index) => ({ kind, pick, index, ...glowWindow(kind, pick, words, D, hookEnd) })))
    .sort((a, b) => priority[b.kind] - priority[a.kind] || a.start - b.start || a.index - b.index);
  const kept = [], dropped = [];
  const drop = (e, reason) => dropped.push({ kind: e.kind, pick: e.pick, reason });
  for (const e of entries) {
    if (words[e.pick.from ?? e.pick.word].start < hookEnd || e.end <= e.start) { drop(e, "title"); continue; }
    // A band icon up to 1.2 s before a scene that opens on the same icon hands over into it (a bridge), so it may run
    // into the scene; anything else waits SCENE_SETTLE after the scene has gone.
    const bridge = (s) => e.kind === "icons" && e.start < s.start && s.start - e.start <= 1.2 && sceneFirstIcon(s.pick) === e.pick.icon;
    if (kept.some((s) => s.kind === "scenes" && e.start < s.end + SCENE_SETTLE - 1e-9 && e.end > s.start && !bridge(s))) { drop(e, "scene-settle"); continue; }
    const prev = kept.filter((s) => s.kind === e.kind).at(-1);
    if (prev && ((e.kind === "scenes" && (prev.pick.type || "icons") === (e.pick.type || "icons")) || (e.kind === "icons" && prev.pick.icon === e.pick.icon))) { drop(e, "repeat"); continue; }
    const band = [...kept.filter((s) => s.kind !== "scenes"), e].sort((a, b) => a.start - b.start);
    if (e.kind !== "scenes" && band.some((s, i) => band[i + BAND_MAX] && band[i + BAND_MAX].start - s.start < 3 - 1e-9)) { drop(e, "band-window"); continue; }
    kept.push(e);
  }
  const cleanTime = () => {
    const spans = [{ start: 0, end: Math.min(D, hookEnd) }, ...kept].sort((a, b) => a.start - b.start);
    let end = 0, covered = 0;
    for (const s of spans) { covered += Math.max(0, s.end - Math.max(end, s.start)); end = Math.max(end, s.end); }
    return Math.max(0, D - covered);
  };
  // Remove the least valuable remaining pick first; ties keep the earlier argument beat. Without a known reel length
  // there is no share to hold to.
  while (Number.isFinite(duration) && kept.length && cleanTime() < D * CLEAN_SHARE - 1e-9) drop(kept.pop(), "clean-hold");
  const out = Object.fromEntries(Object.keys(priority).map((kind) => [kind, kept.filter((e) => e.kind === kind).sort((a, b) => a.start - b.start || a.index - b.index).map((e) => e.pick)]));
  const starts = [...new Set(kept.map((e) => e.start))].sort((a, b) => a - b);
  const cleanSeconds = cleanTime(), cleanFraction = D ? cleanSeconds / D : 0;
  return { picks: out, dropped, cleanSeconds, cleanFraction, onTarget: cleanFraction >= CLEAN_SHARE && cleanFraction <= CLEAN_MAX,
    gaps: [Math.min(D, hookEnd), ...starts, D].slice(1).map((end, i) => ({ start: i ? starts[i - 1] : Math.min(D, hookEnd), end })).filter((g) => g.end - g.start > 4) };
}
