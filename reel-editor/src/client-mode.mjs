// Client mode is a kit install on a client's own Mac (install.sh --brand writes REEL_CLIENT_MODE=1 into ~/.reel/env.sh).
// REEL_CLIENT alone is not enough: Greg's Mac sets it for the client folders it runs (scripts/client.mjs), and there
// Greg's tools (compiling the Swift helpers, his presets as a base) must keep working.
export const GREG_PRESETS = Object.freeze(["pingel-brand", "pingel-v2", "pingel-runway", "pingel-bold"]);

export function isClientMode(env = process.env) {
  return env.REEL_CLIENT_MODE === "1";
}

// A client's job anywhere: a kit install, or a client folder Greg runs on his own Mac (REEL_CLIENT set by
// scripts/client.mjs). Used for what a client must never get from Greg: his presets as a look, his caption voice,
// his Sandcastles watchlist. Kit-only things (no compiling, no npx) stay on isClientMode.
export function isClientJob(env = process.env) {
  return isClientMode(env) || !!String(env.REEL_CLIENT || "").trim();
}
