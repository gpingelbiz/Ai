import os from "node:os";
import path from "node:path";
import { kitSlug } from "./brandkit.mjs";

/**
 * Clients on this Mac: Greg's team edits a client's footage here, in the client's brand. Each client is a Reels
 * root of its own (~/Reels/clients/<slug>) with the same six drop folders, its own work files, log, music, look
 * history and word list, a Content Studio whose Publish folder posts finished reels into the client's Metricool brand
 * (posting off until Greg picks that brand), and its finished reels in ~/Desktop/Reels/Clients/<Name>. Nothing of Greg's brand (his
 * colors, @handle, voice, frameworks, Greg card look, Sandcastles watchlist, CTA) reaches a client's reel.
 */

export const DROP_FOLDERS = [
  ["raw", "Raw - Reel"],
  ["raw-broll", "Raw - Reel with B-roll"],
  ["raw-carousel", "Raw - Carousel"],
  ["raw-long", "Raw - Clips from Long Video"],
  ["raw-youtube", "Raw - Full YouTube Edit"],
  ["raw-runway", "Raw - Reel with Runway B-roll"],
];

export const clientsRoot = (env = process.env) => env.REEL_CLIENTS || path.join(os.homedir(), "Reels", "clients");
export const clientsDesktop = (env = process.env) => env.REEL_CLIENTS_DESKTOP || path.join(os.homedir(), "Desktop", "Reels", "Clients");

/** A folder-safe display name ("Jane Doe"), for the Desktop folder. */
export const displayName = (b) => String(b.name || "Client").replace(/[/:\\*?"<>|]+/g, " ").replace(/\s+/g, " ").trim() || "Client";

/** Every path a client uses. */
export function clientPaths(brand, env = process.env) {
  const slug = kitSlug(brand);
  const root = path.join(clientsRoot(env), slug);
  const desktop = path.join(clientsDesktop(env), displayName(brand));
  return {
    slug, root, desktop,
    preset: path.join(root, "preset.json"),
    youtube: path.join(root, "youtube.json"),
    dictionary: path.join(root, "dictionary.json"),
    voice: path.join(root, "voice.md"),
    brand: path.join(root, "brand.json"),
    env: path.join(root, "client.env"),
    music: path.join(root, "music"),
    studio: path.join(root, "Content Studio"),
    cache: path.join(root, "cache"),
    fonts: path.join(root, "fonts"),
    drops: DROP_FOLDERS.map(([dir, label]) => ({ dir: path.join(root, dir), label })),
    label: `com.pingel.reel-watch.client.${slug}`,
  };
}

const q = (v) => `'${String(v).replace(/'/g, `'\\''`)}'`;

/**
 * client.env: what the watcher sets for every job of this client. Every setting that has a Greg default is set
 * explicitly, so a value from ~/.zshrc (his Desktop folder, his CTA) can never fill in for a client.
 */
export function clientEnv(brand, p) {
  const vars = {
    REEL_CLIENT: brand.name,
    REEL_PRESET: p.preset,
    REEL_YOUTUBE_PRESET: p.youtube,
    REEL_DICTIONARY: p.dictionary,
    REEL_CAPTION_VOICE: p.voice,
    REEL_CAPTION_WATCHLIST: "0",
    REEL_CACHE: p.cache,
    REEL_WATCH_ROOT: p.root,
    REEL_WATCH_DONE: p.desktop,
    REEL_WATCH_MUSIC: p.music,
    REEL_WATCH_CTA: String(brand.cta || "").trim(),
  };
  return "# Set by scripts/client.mjs for every drop-folder job of this client. Re-run `client.mjs add` to change it.\n"
    + Object.entries(vars).map(([k, v]) => `${k}=${q(v)}`).join("\n") + "\n";
}

const xml = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/**
 * The client's launchd agent: it only wakes the one shared watcher (watch-folder.sh, with Greg's own folder
 * settings, so it scans everything under one lock and jobs never run two at a time) when a client drop folder
 * changes. Greg's own agent is never touched.
 */
export function agentPlist({ label, script, env, watch, log }) {
  const vars = Object.entries(env).map(([k, v]) => `    <key>${xml(k)}</key><string>${xml(v)}</string>`).join("\n");
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>${xml(label)}</string>
  <key>ProgramArguments</key>
  <array>
    <string>/bin/bash</string>
    <string>${xml(script)}</string>
  </array>
  <key>EnvironmentVariables</key>
  <dict>
${vars}
  </dict>
  <key>WatchPaths</key>
  <array>${watch.map((w) => `<string>${xml(w)}</string>`).join("")}</array>
  <key>RunAtLoad</key><false/>
  <key>ThrottleInterval</key><integer>10</integer>
  <key>StandardOutPath</key><string>${xml(log)}</string>
  <key>StandardErrorPath</key><string>${xml(log)}</string>
</dict>
</plist>
`;
}
