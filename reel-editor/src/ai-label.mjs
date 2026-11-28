/**
 * Instagram's AI label on a reel (Greg 2026-11-28): on when the reel shows AI-made pictures or uses an AI voice, since
 * Meta requires the label on realistic AI video and audio. B-roll that is real footage (Pixabay, Pexels or Wikimedia
 * stock, or the owner's own clips) does not count. A shot with no source on record counts as AI, so older plans keep
 * the label.
 */
const REAL = new Set(["pixabay", "pexels", "wikimedia", "own"]);

/** Where a B-roll shot's picture came from. A library clip carries the licence of the place it first came from. */
export function shotOrigin(shot = {}) {
  if (shot.stillSource) return String(shot.stillSource);
  if (shot.source && shot.source !== "library") return String(shot.source);
  return shot.licence?.provider || shot.provider || null;
}

export const aiShot = (shot) => !REAL.has(String(shotOrigin(shot) || "").toLowerCase());

/** Whether a reel's plan.json earns Instagram's AI label. */
export function aiLabel(plan = {}) {
  return !!plan.aiVoice || (plan.broll || []).some(aiShot);
}
