import { r3 } from "./util.mjs";

// Durations measured with ffprobe, including the pitch variants (assets/sfx/NOTICE.md).
const SOUNDS = {
  move: { files: ["move.wav", "move-2.wav", "move-3.wav"], durations: [0.153542, 0.143479, 0.165104], volume: 0.8 },
  card: { files: ["card.wav", "card-2.wav", "card-3.wav"], durations: [0.294604, 0.275313, 0.316792], volume: 0.6 },
  slam: { files: ["slam.wav", "slam-2.wav", "slam-3.wav"], durations: [0.173208, 0.161896, 0.18625], volume: 1 },
  ding: { files: ["ding.wav"], durations: [0.42], volume: 0.5 },
  typing: { files: ["typing.wav"], durations: [0.5], volume: 0.3 },
};

/** Sounds for the final glow layout, never the old look's zooms, graphics, slams or hook. */
export function glowSoundCues(plan, { level = 0.3 } = {}) {
  const audio = plan.style?.audio;
  level = audio?.soundsVolume ?? level;
  if (audio?.sounds === false || !Number.isFinite(level) || level <= 0) return [];
  const cues = [];
  const add = (family, at, scale = 1) => {
    if (!Number.isFinite(at)) return;
    const start = r3(Math.max(0, at));
    // Like the old look's cues, nothing in the last 0.2 s (the render trims there).
    if (start >= (plan.video?.duration ?? Infinity) - 0.2) return;
    const duck = (plan.words || []).some((w) => start >= w.start && start < w.end) ? 0.6 : 1;
    cues.push({ family, start, volume: r3(level * SOUNDS[family].volume * scale * duck) });
  };
  for (const scene of plan.glowScenes || []) {
    add("move", scene.start);
    // Timed collections also cover new scene types such as flows and bars.
    for (const item of [...(scene.items || []), ...(scene.bars || [])]) add("card", item.at, 0.75);
    if (scene.right) add("card", scene.right.at, 0.75);
    // Match the number's scale landing and the meter's completed fill in GLOW_SCENES_JS.
    if (scene.type === "number") add("card", scene.start + 0.43);
    if (scene.type === "meter") add("card", scene.start + 1.08);
    for (const bubble of scene.bubbles || []) {
      if (bubble.side === "me") add("typing", bubble.at - SOUNDS.typing.durations[0]);
      if (bubble.side === "them") add("ding", bubble.at);
    }
  }
  for (const overlay of plan.glowOverlays || []) {
    if (overlay.type === "stamp") add("slam", overlay.start);
    if (overlay.type === "notify") add("ding", overlay.start);
  }
  for (const icon of plan.icons || []) add("card", icon.t, 0.75);

  // Choose by audible level first so a later, louder cue also wins; only kept whooshes count toward the cap.
  const kept = [];
  for (const cue of cues.sort((a, b) => b.volume - a.volume || a.start - b.start)) {
    if (kept.some((c) => Math.abs(c.start - cue.start) < 0.12 - 1e-9)) continue;
    if (cue.family === "move" && kept.some((c) => c.family === "move" && Math.abs(c.start - cue.start) < 1.5 - 1e-9)) continue;
    kept.push(cue);
  }
  const counts = {};
  return kept.sort((a, b) => a.start - b.start).map((cue) => {
    const sound = SOUNDS[cue.family];
    const n = counts[cue.family] = (counts[cue.family] || 0) + 1;
    const variant = (n - 1) % sound.files.length;
    return { id: `sfx-${cue.family}-${n}`, src: `assets/sfx/${sound.files[variant]}`, start: cue.start, duration: sound.durations[variant], volume: cue.volume, track: 9 };
  });
}
