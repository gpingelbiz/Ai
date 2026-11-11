import { r3 } from "./util.mjs";
import { eventClock, glowLanding } from "./event-clock.mjs";

// Durations measured with ffprobe, including the pitch variants (assets/sfx/NOTICE.md).
const SOUNDS = {
  move: { files: ["move.wav", "move-2.wav", "move-3.wav"], durations: [0.153542, 0.143479, 0.165104], volume: 0.8 },
  card: { files: ["card.wav", "card-2.wav", "card-3.wav"], durations: [0.294604, 0.275313, 0.316792], volume: 0.6 },
  slam: { files: ["slam.wav", "slam-2.wav", "slam-3.wav"], durations: [0.173208, 0.161896, 0.18625], volume: 1 },
  ding: { files: ["ding.wav"], durations: [0.42], volume: 0.5 },
  typing: { files: ["typing.wav"], durations: [0.5], volume: 0.3 },
  marker: { files: ["marker.wav"], durations: [0.161104], volume: 0.45 },
};

/** Sounds for the final glow layout, never the old look's zooms, graphics, slams or hook. */
export function glowSoundCues(plan, { level = 0.3, audit = false } = {}) {
  const audio = plan.style?.audio;
  level = audio?.soundsVolume ?? level;
  if (audio?.sounds === false || !Number.isFinite(level) || level <= 0) return [];
  const fps = plan.style?.render?.fps || 30;
  const landing = (kind, event, context = {}) => glowLanding(kind, event, { ...context, scenes: plan.glowScenes || [], fps });
  const cues = [];
  const add = (family, at, landAt, scale = 1, box, anchor = "peak") => {
    if (!Number.isFinite(at)) return;
    const start = r3(Math.max(0, at));
    // Like the old look's cues, nothing in the last 0.2 s (the render trims there).
    if (start >= (plan.video?.duration ?? Infinity) - 0.2) return;
    const duck = (plan.words || []).some((w) => start >= w.start && start < w.end) ? 0.6 : 1;
    cues.push({ family, start, landAt, box, anchor, volume: r3(level * SOUNDS[family].volume * scale * duck) });
  };
  // Selection, ducking and variant rotation keep their former clock. Only accepted cue starts move.
  for (const scene of plan.glowScenes || []) {
    add("move", scene.start, landing("scene", scene));
    // Timed collections also cover new scene types: list, steps and flow items, a flow's branch, the right side of a
    // versus or bars (the left one lands with the entrance).
    [...(scene.items || []), ...(scene.bars || [])].forEach((item, index) => add("card", item.at, landing("item", scene, { at: item.at, index }), 0.75));
    if (scene.branch) add("card", scene.branch.at, landing("branch", scene, { at: scene.branch.at }), 0.5);
    if (scene.right) add("card", scene.right.at, landing("right", scene, { at: scene.right.at }), 0.75);
    // Keep the former number-selection times; declared landings follow the entrance, count or meter fill endpoint.
    if (scene.type === "number") add("card", scene.from == null ? scene.start + 0.15 : scene.start + Math.min(0.9, Math.max(0.4, scene.end - scene.start - 0.68)), landing("number", scene));
    if (scene.type === "meter") add("card", scene.start + 1.08, landing("meter", scene));
    // Thread bubbles: plan times are display times (layoutGlow spaces them); typing runs under the 0.4 s of dots.
    let last = -Infinity;
    for (const bubble of scene.bubbles || []) {
      const at = last = Math.max((scene.start ?? 0) + 0.4, bubble.at, last + 0.85);
      if (bubble.side === "me") add("typing", bubble.at - 0.4, landing("typing", scene, { at }), 1, undefined, "attack");
      if (bubble.side === "them") add("ding", bubble.at, landing("bubble", scene, { at }));
    }
  }
  for (const overlay of plan.glowOverlays || []) {
    if (overlay.type === "stamp") add("slam", overlay.start, landing("stamp", overlay), 1, overlay.place);
    if (overlay.type === "notify") add("ding", overlay.start, landing("notify", overlay), 1, overlay.place);
  }
  // A swap line's strike: a soft marker stroke when the right word is said.
  for (const g of plan.captions || []) {
    if (g.kind !== "feat" || g.variant !== "swap") continue;
    const right = (g.words || []).find((w) => w.right);
    if (right) add("marker", Math.max(g.start, right.start), landing("swap", g, { at: right.start }), 1, g.place);
  }
  // The principal icon, hit ring and ping badge each have their own entrance endpoint in GLOW_ICONS_JS.
  (plan.icons || []).forEach((icon, index) => {
    const box = { x: icon.x, y: icon.y, w: icon.size, h: icon.size };
    add("card", icon.t, landing("icon", icon, { index }), 0.75, box);
    if (icon.action === "hit") add("slam", icon.t + 0.16, landing("hit", icon, { index }), 0.4, box);
    if (icon.action === "ping") add("ding", icon.t + 0.16, landing("ping", icon, { index }), 0.5, box);
  });

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
    const sync = eventClock({ landAt: cue.landAt, sfx: sound.files[variant], fps, anchor: cue.anchor });
    return { id: `sfx-${cue.family}-${n}`, src: `assets/sfx/${sound.files[variant]}`, start: sync.start, duration: sound.durations[variant], volume: cue.volume, track: 9, ...(audit ? { sync: { ...sync, box: cue.box } } : {}) };
  });
}
