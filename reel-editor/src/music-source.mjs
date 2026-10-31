import fs from "node:fs";
import path from "node:path";

/**
 * A client's Music folder starts empty: Greg's tracks are Epidemic Sound downloads licensed to Greg, so every client
 * brings their own (Greg 2026-10-31: "client brings their own", "lead to where i got the sound from", "clickable links
 * to the subs"). The folder gets a note and two double-click links (.webloc: a text file is not clickable on a Mac).
 */

export const MUSIC_SOURCE = {
  name: "Epidemic Sound",
  music: "https://www.epidemicsound.com/music/featured/",
  plans: "https://www.epidemicsound.com/pricing/",
};

export const MUSIC_LINKS = [
  ["Get music (Epidemic Sound).webloc", MUSIC_SOURCE.music],
  ["Epidemic Sound plans.webloc", MUSIC_SOURCE.plans],
];

export const MUSIC_NOTE_NAME = "Put music here.txt";

const xml = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/** A Finder link file: double-clicking it opens the address in the browser. */
export const weblocXML = (url) => `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>URL</key>
  <string>${xml(url)}</string>
</dict>
</plist>
`;

export function musicNote() {
  return [
    "Your music goes in this folder (mp3, m4a or wav). Every reel gets one track, low under your voice.",
    "",
    `Where Greg's music comes from: ${MUSIC_SOURCE.name}. Get your own subscription so the license covers your own channels.`,
    `  Plans: double-click "Epidemic Sound plans" here, or open ${MUSIC_SOURCE.plans}`,
    `  Music: double-click "Get music (Epidemic Sound)" here, or open ${MUSIC_SOURCE.music}`,
    "  Connect your Instagram, TikTok and YouTube in your Epidemic Sound account so your posts are cleared.",
    "",
    "Download tracks and drop them here. Name each one Mood - Title - Artist.mp3, for example",
    '"Lofi - Falling - Mizlo.mp3". The editor picks a track by the mood of what you say, so start each name with',
    "a mood: Acoustic, Build, Dark Beat, Epic, Lofi, Motivation, Piano, Soul, Tense, Trap, Worship or your own word.",
    'Put "Signature " in front (Signature Piano - ...) for the tracks that are your sound: they come back more often.',
    "Make a folder called Bench in here to park tracks you are resting.",
    "",
    'Name a clip "...#music:calm.mov" to use the track whose name has "calm", or "...#nomusic.mov" for none.',
    "",
  ].join("\n");
}

/** Old installer notes that the new one replaces (a note the person wrote themselves is kept). */
const OLD_NOTE = /^Drop licensed music files here \(mp3, m4a or wav\), for example Epidemic Sound downloads\./;

/** Write the note and the two links into a client's music folder. Tracks and a note of their own are never touched. */
export function setUpMusicFolder(dir) {
  fs.mkdirSync(dir, { recursive: true });
  const out = [];
  const note = path.join(dir, MUSIC_NOTE_NAME);
  const current = fs.existsSync(note) ? fs.readFileSync(note, "utf8") : null;
  if (current === null || OLD_NOTE.test(current)) { fs.writeFileSync(note, musicNote()); out.push(MUSIC_NOTE_NAME); }
  for (const [name, url] of MUSIC_LINKS) {
    const file = path.join(dir, name);
    if (!fs.existsSync(file)) { fs.writeFileSync(file, weblocXML(url)); out.push(name); }
  }
  return out;
}
