import { r3 } from "./util.mjs";

/**
 * Sound design from the plan: the editor's own edits get their own small sounds (CC0, vendored in assets/sfx,
 * see NOTICE.md there). Each cue is one audio track in the composition, mixed under the voice by HyperFrames with
 * the music ducking and the true-peak master. Levels are fractions of the file's own level (peaks at -6 dB).
 */
export const SOUNDS = {
  card: { file: "card.wav", duration: 0.3, volume: 0.9 },
  slam: { file: "slam.wav", duration: 0.18, volume: 1.0 },
  move: { file: "move.wav", duration: 0.16, volume: 0.8 },
  flash: { file: "flash.wav", duration: 0.16, volume: 1.0 },
  marker: { file: "marker.wav", duration: 0.17, volume: 0.45 },
  icon: { file: "card.wav", duration: 0.3, volume: 0.45 },
};

/**
 * Build the cue list. `level` scales every cue (preset audio.soundsVolume). Marker scratches are off unless
 * `markers` is true (Greg: the chirps on the words were too much); when on, one per caption line and never
 * within 0.35 s of a louder cue.
 * Returns [{id, src, start, duration, volume, track}].
 */
export function soundCues({ zooms = [], graphics = [], slams = [], icons = [], broll = [], brollCut = "hard", coldOpen = null, captions = [], annotate = false, markers = false, level = 0.3, lead = { move: 0.06, slam: 0.02, card: 0.0, icon: 0.0, flash: 0.05, marker: 0.0 } } = {}) {
  const cues = [];
  const add = (kind, at) => cues.push({ kind, at: r3(Math.max(0, at - (lead[kind] || 0))) });
  for (const z of zooms) if (z.scale > 1 && !z.cut) add("move", z.t);
  for (const g of graphics) if (g.type !== "progress") add("card", g.start + 0.1);
  for (const s of slams) add("slam", s.t + 0.3);
  // Window and split cutaways have their own entrance, so only a full or cutout cutaway whips (and whooshes).
  if (brollCut === "whip") for (const b of broll) if (!["window", "split"].includes(b.layout)) { add("move", b.start); add("move", b.start + b.duration); }
  for (const icon of icons) add("icon", icon.t);
  if (coldOpen) add("flash", coldOpen.duration);
  if (annotate && markers) {
    for (const g of captions) {
      const w = (g.words || []).find((x) => x.key);
      if (w) add("marker", Math.max(g.start, w.start ?? g.start) + 0.04);
    }
  }
  const loud = cues.filter((c) => c.kind !== "marker");
  const kept = cues.filter((c) => c.kind !== "marker" || !loud.some((l) => Math.abs(l.at - c.at) < 0.35));
  const counts = {};
  return kept
    .sort((a, b) => a.at - b.at)
    .map((c) => {
      const s = SOUNDS[c.kind];
      counts[c.kind] = (counts[c.kind] || 0) + 1;
      return { id: `sfx-${c.kind}-${counts[c.kind]}`, src: `assets/sfx/${s.file}`, start: c.at, duration: s.duration, volume: r3(level * s.volume), track: 9 };
    });
}

export function describeCues(tracks) {
  const n = {};
  for (const t of tracks) { const k = t.id.split("-")[1]; n[k] = (n[k] || 0) + 1; }
  return Object.entries(n).map(([k, v]) => `${v} ${k}${v === 1 ? "" : "s"}`).join(", ");
}
