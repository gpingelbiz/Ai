export const GREG_PRESETS = Object.freeze(["pingel-brand", "pingel-v2", "pingel-runway"]);

export function isClientMode(env = process.env) {
  return env.REEL_CLIENT_MODE === "1" || !!String(env.REEL_CLIENT || "").trim();
}
