export const GREG_PRESETS = ["pingel-brand", "pingel-v2", "pingel-runway"];
export function isClientMode(env = process.env) { return env.REEL_CLIENT_MODE === "1"; }
