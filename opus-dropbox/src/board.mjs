/** A read-only copy of the command center for a claude.ai artifact: the routine sends it the snapshot this writes. */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { home, writeJSON } from "./store.mjs";
import { scrub, watchReport } from "./watch.mjs";

export const dropboxLink = (p) => "https://www.dropbox.com/home" + p.split("/").map(encodeURIComponent).join("/");
export const REEL_FOLDER = /^\d{4}-\d{2}-\d{2} Reel (\d+)$/;
const MAX_BYTES = 200 * 1024; // an artifact document holds 256 KB
const clean = (value, c) => JSON.parse(JSON.stringify(value, (k, v) => typeof v === "string" ? scrub(v, c) : v));

/** The dated reel folders in the finished folder, newest first. */
export async function reelFolders(dropbox, finished) {
  return (await dropbox.list(finished)).filter((e) => e[".tag"] === "folder" && REEL_FOLDER.test(e.name))
    .sort((a, b) => b.name.localeCompare(a.name, undefined, { numeric: true }));
}

/** What one reel folder shows: its day, title and caption. */
export async function reelEntry(dropbox, folder, c) {
  const files = await dropbox.list(folder.path_display);
  const video = files.find((e) => e[".tag"] === "file" && /\.mp4$/i.test(e.name));
  const caption = files.find((e) => e[".tag"] === "file" && e.name === "caption.txt");
  return clean({ day: folder.name.slice(0, 10), name: folder.name, number: Number(folder.name.match(REEL_FOLDER)[1]), title: video?.name.replace(/\.mp4$/i, "") || folder.name,
    caption: caption ? await dropbox.downloadText(caption.path_display) : "" }, c);
}

/** Only named fields go out: never a key, a sign-in or a share link. */
export async function snapshot({ c, state, clients, job, now = Date.now(), limit = 30 }) {
  const report = await watchReport({ c, state, clients, job, now });
  const videos = Object.values(state.items || {}).filter((it) => it.status !== "done" && it.status !== "existing")
    .map((it) => ({ name: it.name, status: it.status, stage: it.stage, error: it.error }));
  const folders = c.folders.finished ? await reelFolders(clients.dropbox, c.folders.finished).catch(() => null) : [];
  const reels = [];
  const problems = [...report.problems];
  if (!folders) problems.push("The finished folder could not be read.");
  for (const folder of (folders || []).slice(0, limit)) {
    try { reels.push({ ...await reelEntry(clients.dropbox, folder, c), path: folder.path_display }); }
    catch (e) { reels.push({ day: folder.name.slice(0, 10), name: folder.name, number: Number(folder.name.match(REEL_FOLDER)[1]), title: folder.name, path: folder.path_display }); }
  }
  const out = { updatedAt: new Date(now).toISOString(), problems, job: report.job, lastRun: report.lastRun, counts: report.counts, reelCount: (folders || []).length, videos: clean(videos, c), reels };
  for (const r of out.reels) if (r.caption?.length > 1500) r.caption = r.caption.slice(0, 1500);
  // Scrubbing removes every link, so the one link the board may show goes in afterwards.
  const paths = out.reels.map((r) => r.path);
  const final = clean(out, c);
  final.reels = final.reels.map(({ path: _, ...r }, i) => ({ ...r, url: dropboxLink(paths[i]) }));
  while (Buffer.byteLength(JSON.stringify(final)) > MAX_BYTES && final.reels.length) final.reels.pop();
  return final;
}

export const snapshotPath = () => path.join(home(), "board-snapshot.json");
export function writeSnapshot(s) { writeJSON(snapshotPath(), s); return snapshotPath(); }

export const boardPagePath = () => path.join(home(), "Reel Board.html");
const BOARD_RULES = { db: { rules: [{ path: "", read: "view", write: "owner" }] } };

/** The routine once the board exists: the health report, then one update of the board. */
export function boardRoutine(command, url) {
  return `# Opus watch

1. Execute this exact command as a single Bash command:

${command("watch --notify")}

2. Execute this exact command as a single Bash command. It prints the path of a JSON file:

${command("snapshot")}

3. Update the board at ${url} with the ArtifactData tool, collection "board", doc_id "current". Read the document with action "get" and an out_dir in your scratchpad to learn its version without printing it, then action "set" with file_path set to the printed path and if_version set to that version. If the document does not exist yet, leave out if_version. If a pinned write says the version changed, read once more and repeat the write once.

4. Report one short line per problem and per newly done video, or "All good", and say whether the board updated.

Never run send, recut, run, setup, stop, start or settings changes. Never write to any other artifact or collection. Never read config.json or state.json, and never print the snapshot. Never send messages. Stop after the report.
`;
}

/** The prompt pasted once in the Claude app: publish the page, fill it, point the routine at it. */
export function boardPrompt(command) {
  return `Set up a read-only board for this Mac's reels. Do these steps in order and stop if one fails.

1. Load the Artifact tool. Read ${boardPagePath()} in full. Publish that file as a new artifact, as it is, with icon "video", the description "Finished reels and what is on the way, updated hourly from the Mac.", and capabilities exactly ${JSON.stringify(BOARD_RULES)}. If the tool refuses that path, copy the file to your scratchpad and publish the copy. Do not change the page. Do not publish anything else.

2. Execute this exact command as a single Bash command. It prints the path of a JSON file. Do not print the file:

${command("snapshot")}

3. With the ArtifactData tool, action "set", collection "board", doc_id "current", file_path set to that path, write the first copy to the new artifact's url. Then read it back once with action "get" and an out_dir in your scratchpad, and check the file exists.

4. Replace the prompt of the scheduled task opus-watch using update_scheduled_task with the text between the lines below, putting the new artifact's url in place of ARTIFACT_URL. Keep its cron as it is.

-----
${boardRoutine(command, "ARTIFACT_URL")}
-----

5. Say in one or two lines that the board is published, give its link, and say whether the routine was updated.
`;
}

export function installBoard({ command, say = console.log, copy }) {
  const src = path.join(path.dirname(fileURLToPath(import.meta.url)), "board-page.html");
  fs.mkdirSync(home(), { recursive: true });
  fs.copyFileSync(src, boardPagePath());
  const prompt = boardPrompt(command);
  say("Paste this prompt in the Claude app Code tab:");
  say(prompt);
  if (copy?.(prompt)?.status === 0) say("The prompt is copied. Paste it in the Claude app Code tab.");
  return prompt;
}
