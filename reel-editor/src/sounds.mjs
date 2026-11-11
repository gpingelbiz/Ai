import fs from "node:fs";
import path from "node:path";
import { r3 } from "./util.mjs";
import { eventClock, legacyLanding } from "./event-clock.mjs";

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
 * Returns [{id, src, start, duration, volume, track}]. Entrance endpoints are declared in event-clock.mjs.
 * The former lead clock is used only for selection/order, so correcting sync cannot change which sounds play.
 * audit adds transient/landing details for sync-check; normal plans retain the existing track schema.
 */
export function soundCues({ zooms = [], graphics = [], slams = [], icons = [], broll = [], brollCut = "hard", coldOpen = null, captions = [], annotate = false, markers = false, level = 0.3, lead = { move: 0.06, slam: 0.02, card: 0.0, icon: 0.0, flash: 0.05, marker: 0.0 }, fps = 30, zoomStyle = "snap", graphicsMode = "overlay", duration = Infinity, audit = false } = {}) {
  const cues = [];
  const landing = (kind, event) => legacyLanding(kind, event, { fps, zoomStyle, graphicsMode });
  const add = (kind, at, landAt, box) => cues.push({ kind, at: r3(Math.max(0, at - (lead[kind] || 0))), landAt, box });
  for (const z of zooms) if (z.scale > 1 && !z.cut) add("move", z.t, landing("move", z));
  for (const g of graphics) if (g.type !== "progress") add("card", g.start + 0.1, landing("card", g), g.box);
  for (const s of slams) add("slam", s.t + 0.3, landing("slam", s), s.popout?.placement);
  // Window and split cutaways have their own entrance, so only a full or cutout cutaway whips (and whooshes).
  if (brollCut === "whip") for (const b of broll) if (!["window", "split"].includes(b.layout)) { add("move", b.start, landing("whip-in", b)); add("move", b.start + b.duration, landing("whip-out", b)); }
  for (const icon of icons) add("icon", icon.t, landing("icon", icon), { x: icon.x, y: icon.y, w: icon.size, h: icon.size });
  if (coldOpen) add("flash", coldOpen.duration, landing("flash", coldOpen));
  if (annotate && markers) {
    for (const g of captions) {
      const w = (g.words || []).find((x) => x.key);
      if (w) add("marker", Math.max(g.start, w.start ?? g.start) + 0.04, landing("marker", { start: g.start, wordStart: w.start }));
    }
  }
  const loud = cues.filter((c) => c.kind !== "marker");
  const kept = cues.filter((c) => c.kind !== "marker" || !loud.some((l) => Math.abs(l.at - c.at) < 0.35));
  const counts = {};
  return kept
    .sort((a, b) => a.at - b.at)
    .filter((c) => c.at < duration - 0.2)
    .map((c) => {
      const s = SOUNDS[c.kind];
      const sync = eventClock({ landAt: c.landAt, sfx: s.file, fps });
      counts[c.kind] = (counts[c.kind] || 0) + 1;
      return { id: `sfx-${c.kind}-${counts[c.kind]}`, src: `assets/sfx/${s.file}`, start: sync.start, duration: s.duration, volume: r3(level * s.volume), track: 9, ...(audit ? { sync: { ...sync, box: c.box } } : {}) };
    });
}

export function describeCues(tracks) {
  const n = {};
  for (const t of tracks) { const k = t.id.split("-")[1]; n[k] = (n[k] || 0) + 1; }
  return Object.entries(n).map(([k, v]) => `${v} ${k}${v === 1 ? "" : "s"}`).join(", ");
}

/** Generated sound follows the accepted, trimmed shot and sits under the voice, on its own track (10) so it never shares one with the cut cues. */
export function brollSoundTracks(broll, assets, { volume = 0.35 } = {}) {
  return broll.filter((b) => b.sfx && fs.existsSync(b.sfx)).map((b, i) => {
    const name = `broll-${i + 1}.sfx.wav`;
    fs.copyFileSync(b.sfx, path.join(assets, name));
    return { id: `sfx-broll-${i + 1}`, src: `assets/${name}`, start: b.start, duration: b.duration, volume: b.sfxMix?.volume ?? volume, ...(b.sfxMix?.lane ? { lane: b.sfxMix.lane } : {}), track: 10 };
  });
}
