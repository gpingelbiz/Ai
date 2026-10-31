import { weblocXML } from "./music-source.mjs";

/**
 * What a client signs up for to get everything Greg's setup does, each with the page to subscribe on (every
 * address checked 2026-10-31). The kit's Start Here lists them with clickable links and the kit folder carries a
 * "Sign up here" folder of double-click links. `studio` says whether a Content Studio kit needs it; `reel` the same
 * for a reel-only kit ("" = not part of that kit).
 */
export const SIGNUPS = [
  { id: "claude", name: "Claude (Pro or Max)", url: "https://claude.com/pricing", what: "graphic cards, captions and hook ideas in your reels", whatStudio: "graphic cards, captions and hook ideas in your reels; it also writes your posts and schedules them", studio: "Needed", reel: "Recommended" },
  { id: "metricool", name: "Metricool", url: "https://metricool.com/pricing/", what: "posts everything to your Instagram by itself (and TikTok, Facebook, LinkedIn or Threads if you connect them there)", studio: "Needed", reel: "" },
  { id: "epidemic", name: "Epidemic Sound", url: "https://www.epidemicsound.com/pricing/", what: "the music under your reels, on your own plan so the license covers your channels", studio: "For music", reel: "For music" },
  { id: "chatgpt", name: "ChatGPT", url: "https://chatgpt.com/pricing/", what: "AI b-roll pictures and carousel images (Codex, on your ChatGPT plan)", studio: "Optional", reel: "Optional" },
  { id: "elevenlabs", name: "ElevenLabs", url: "https://elevenlabs.io/pricing", what: "the most accurate transcription (your API key: Developers, API Keys)", studio: "Optional", reel: "Optional" },
  { id: "runway", name: "Runway API", url: "https://dev.runwayml.com/", what: "short AI video clips as b-roll in Raw - Reel with Runway B-roll, about 30 cents a clip (buy credits and make an API key there)", studio: "Optional", reel: "Optional" },
  { id: "sandcastles", name: "Sandcastles", url: "https://sandcastles.ai/#pricing", what: "captions and hooks that follow what is winning on short video right now (connect it in Claude)", studio: "Optional", reel: "Optional" },
];

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);

/** The services for one kind of kit, in order. */
export const signupsFor = ({ studio = false } = {}) => SIGNUPS.filter((s) => (studio ? s.studio : s.reel)).map((s) => ({ ...s, need: studio ? s.studio : s.reel, what: (studio && s.whatStudio) || s.what }));

/** The Start Here table: what each service unlocks, whether this kit needs it, and a link to subscribe. */
export function signupsHTML({ studio = false } = {}) {
  const rows = signupsFor({ studio }).map((s) => `        <tr><td><a href="${esc(s.url)}">${esc(s.name)}</a></td><td>${esc(s.need)}</td><td>${esc(s.what)}</td></tr>`).join("\n");
  return `  <h2>What to sign up for</h2>
  <p>Each one is your own account, on your own card. Click a name to see its plans. The <b>Sign up here</b> folder in this kit has the same links.</p>
  <table>
        <tr><th>Service</th><th>This kit</th><th>What it adds</th></tr>
${rows}
  </table>`;
}

/** The kit's "Sign up here" folder: one double-click link per service ({file name: contents}). */
export function signupLinks({ studio = false } = {}) {
  return Object.fromEntries(signupsFor({ studio }).map((s) => [`${s.name.replace(/[/:\\*?"<>|]+/g, " ").trim()}.webloc`, weblocXML(s.url)]));
}
