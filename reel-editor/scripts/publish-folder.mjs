#!/usr/bin/env node
// The Publish folder's commands, run by the hourly "reel-publish" task (and by hand):
//   node scripts/publish-folder.mjs scan           JSON: the next reel to post, or {"next":null}
//   node scripts/publish-folder.mjs slot '<json>'  JSON: the posting day/hour from {taken:[days], busy:{day:[hours]}, bestByDay:{day:[hours]}, notBefore}
//   node scripts/publish-folder.mjs serve <video>  opens a temporary public link to that one video, prints it
//   node scripts/publish-folder.mjs stop           closes it
//   node scripts/publish-folder.mjs done <entry> --planner <url> --date <iso> [--trial] [--networks instagram,tiktok]
//        [--trial-copy <iso> --trial-planner <url> | --trial-copy-failed <text>] [--draft] [--why <text>]
//   node scripts/publish-folder.mjs fail <entry> --why <text>
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { scan, readItem, fileItem, serve, stop, serveChild, pickSlot, ROOT } from "../src/publish-folder.mjs";

const notify = (title, msg) => { try { spawnSync("osascript", ["-e", `display notification ${JSON.stringify(msg)} with title ${JSON.stringify(title)}`]); } catch {} };

const args = process.argv.slice(2);
const [cmd, a1] = args;
const opt = (k) => { const i = args.indexOf(k); return i > 0 ? args[i + 1] : ""; };
const out = (v) => console.log(JSON.stringify(v, null, 1));

switch (cmd) {
  case "scan": {
    const items = scan();
    const ready = items.filter((i) => i.video && !i.waiting && !i.problem);
    out({ folder: ROOT, next: ready[0] || null, ready, waiting: items.filter((i) => i.waiting).map((i) => i.entry), problems: items.filter((i) => i.problem).map((i) => ({ entry: i.entry, problem: i.problem })), queued: ready.length });
    break;
  }
  case "slot": {
    const j = JSON.parse(a1 || "{}");
    out(pickSlot({ now: new Date(), taken: j.taken || [], busy: j.busy || {}, bestByDay: j.bestByDay || {}, tz: j.tz || "America/Phoenix", notBefore: j.notBefore || null }));
    break;
  }
  case "serve": console.log(await serve(path.resolve(a1), { script: fileURLToPath(import.meta.url) })); break;
  case "serve-child": await serveChild(path.resolve(a1)); break;
  case "stop": console.log((await stop()) ? "closed" : "nothing open"); break;
  case "done":
  case "fail": {
    const item = readItem(a1, { settle: 0 });
    if (!item?.video) { console.error(`not found in ${ROOT}: ${a1}`); process.exit(1); }
    const date = opt("--date");
    const receipt = cmd === "done"
      ? [args.includes("--draft") ? `Saved as a DRAFT in Metricool for you to look at (${opt("--why") || "flagged"}); it will not post until you schedule it there.` : `Scheduled to post on Instagram at ${date}.`, ...(args.includes("--trial") || item.trial ? ["Trial Reel: yes. Instagram shows it to non-followers first."] : []), ...(opt("--trial-copy") ? [`Trial copy: the same reel also goes out as a Trial Reel (non-followers only) at ${opt("--trial-copy")}. Your followers already get the regular one, so don't share the trial copy to them. Metricool: ${opt("--trial-planner") || "(no link returned)"}`] : []), ...(opt("--trial-copy-failed") ? [`Trial copy not posted: ${opt("--trial-copy-failed")}`] : []), ...(opt("--networks").toLowerCase().includes("tiktok") ? ["Also posted to TikTok."] : []), `Metricool: ${opt("--planner") || "(no link returned)"}`, "", "Posted text:", item.text, "", ...(item.notes?.length ? ["The render reviewer noted (check it on the reel; it can be wrong):", ...item.notes.map((n) => `- ${n}`), ""] : [])].join("\n")
      : [`Not posted: ${opt("--why") || "unknown error"}`, "Fix it and drop the folder in Publish again.", ""].join("\n");
    const where = fileItem(item, { status: cmd === "done" ? "scheduled" : "failed", receipt });
    const name = item.entry.replace(/\.(mp4|mov|m4v)$/i, "");
    if (cmd === "fail") notify("Reel not posted", `${name}: ${opt("--why") || "error"}`);
    else if (args.includes("--draft")) notify("Reel saved as a draft", `${name}: ${opt("--why") || "flagged"}. Look at it in Metricool.`);
    else notify("Reel scheduled", `${name} posts on Instagram ${date.replace("T", " ").slice(0, 16)}`);
    console.log(where);
    break;
  }
  default:
    console.error("usage: publish-folder.mjs scan | slot <json> | serve <video> | stop | done <entry> --planner <url> --date <iso> [--trial] [--networks <list>] [--draft] | fail <entry> --why <text>");
    process.exit(2);
}
