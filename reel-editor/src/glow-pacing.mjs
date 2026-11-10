import { r3 } from "./util.mjs";

/** Display windows, including entrances and holds, shared by pacing and layout. */
export function glowWindow(kind, pick, words, duration, hookEnd = 3) {
  const first = words[pick.from ?? pick.word], last = words[pick.to ?? pick.word];
  let start, end;
  if (kind === "scenes") {
    const base = r3(first.start - 0.05);
    const lastAt = Math.max(0, ...(pick.items || []).map((it) => words[it.word].start), pick.right ? words[pick.right.word].start : 0);
    start = base - 0.1;
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

/** Trim checked picks without inventing beats. A sparse plan may exceed the 35% clean-hold target. */
export function pacingReport(picks, words, duration, { hookEnd = 3 } = {}) {
  const D = Number.isFinite(duration) ? Math.max(0, duration) : Math.max(hookEnd, ...words.map((w) => w.end)) + 0.5;
  const priority = { scenes: 3, features: 2, overlays: 1, icons: 0 };
  const entries = Object.keys(priority).flatMap((kind) => (picks[kind] || []).map((pick, index) => ({ kind, pick, index, ...glowWindow(kind, pick, words, D, hookEnd) })))
    .sort((a, b) => priority[b.kind] - priority[a.kind] || a.start - b.start || a.index - b.index);
  const kept = [], dropped = [];
  const drop = (e, reason) => dropped.push({ kind: e.kind, pick: e.pick, reason });
  for (const e of entries) {
    if (words[e.pick.from ?? e.pick.word].start < hookEnd || e.end <= e.start) { drop(e, "title"); continue; }
    if (kept.some((s) => s.kind === "scenes" && e.start < s.end + 1.2 - 1e-9 && e.end > s.start)) { drop(e, "scene-settle"); continue; }
    const prev = kept.filter((s) => s.kind === e.kind).at(-1);
    if (prev && ((e.kind === "scenes" && (prev.pick.type || "icons") === (e.pick.type || "icons")) || (e.kind === "icons" && prev.pick.icon === e.pick.icon))) { drop(e, "repeat"); continue; }
    const band = [...kept.filter((s) => s.kind !== "scenes"), e].sort((a, b) => a.start - b.start);
    if (e.kind !== "scenes" && band.some((s, i) => band[i + 2] && band[i + 2].start - s.start < 3 - 1e-9)) { drop(e, "band-window"); continue; }
    kept.push(e);
  }
  const cleanTime = () => {
    const spans = [{ start: 0, end: Math.min(D, hookEnd) }, ...kept].sort((a, b) => a.start - b.start);
    let end = 0, covered = 0;
    for (const s of spans) { covered += Math.max(0, s.end - Math.max(end, s.start)); end = Math.max(end, s.end); }
    return Math.max(0, D - covered);
  };
  // Remove the least valuable remaining pick first; ties keep the earlier argument beat.
  while (kept.length && cleanTime() < D * 0.25 - 1e-9) drop(kept.pop(), "clean-hold");
  const out = Object.fromEntries(Object.keys(priority).map((kind) => [kind, kept.filter((e) => e.kind === kind).sort((a, b) => a.start - b.start || a.index - b.index).map((e) => e.pick)]));
  const starts = [...new Set(kept.map((e) => e.start))].sort((a, b) => a - b);
  const cleanSeconds = cleanTime(), cleanFraction = D ? cleanSeconds / D : 0;
  return { picks: out, dropped, cleanSeconds, cleanFraction, onTarget: cleanFraction >= 0.25 && cleanFraction <= 0.35,
    gaps: [Math.min(D, hookEnd), ...starts, D].slice(1).map((end, i) => ({ start: i ? starts[i - 1] : Math.min(D, hookEnd), end })).filter((g) => g.end - g.start > 4) };
}
